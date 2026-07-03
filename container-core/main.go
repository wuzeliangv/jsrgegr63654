package main

import (
	"context"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/gorilla/websocket"
)

// Config 运行配置(全部来自环境变量)。
type Config struct {
	Listen           string        // 监听地址,默认 :8080
	WSPath           string        // 入站 WS 路径,需与面板节点 ws_path 一致
	PanelBase        string        // 面板地址,如 https://panel.example.com
	NodeID           int           // 面板中的节点 id
	AgentToken       string        // 面板节点 agent_token
	UserSyncInterval time.Duration // 用户表同步间隔
	ReportInterval   time.Duration // 上报间隔
}

func loadConfig() Config {
	c := Config{
		Listen:           getenv("LISTEN", ":8080"),
		WSPath:           getenv("WS_PATH", "/bing"),
		PanelBase:        strings.TrimRight(getenv("PANEL_BASE", "https://cd.sd"), "/"),
		AgentToken:       os.Getenv("AGENT_TOKEN"),
		UserSyncInterval: getdur("USER_SYNC_INTERVAL", 60*time.Second),
		ReportInterval:   getdur("REPORT_INTERVAL", 5*time.Second),
	}
	c.NodeID, _ = strconv.Atoi(os.Getenv("NODE_ID"))
	if !strings.HasPrefix(c.WSPath, "/") {
		c.WSPath = "/" + c.WSPath
	}
	if c.NodeID == 0 || c.AgentToken == "" {
		log.Fatal("缺少必填环境变量: NODE_ID / AGENT_TOKEN")
	}
	return c
}

// Server 处理入站 VLESS-over-WS 连接。
type Server struct {
	cfg      Config
	upgrader websocket.Upgrader
	users    *UserStore
	meter    *Meter
}

func (s *Server) handleWS(w http.ResponseWriter, r *http.Request) {
	conn, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	stream := newWSStream(conn)

	req, err := parseVLESSRequest(stream)
	if err != nil {
		return
	}

	// 鉴权:UUID 必须在已同步的用户表中
	userID, ok := s.users.Lookup(uuidString(req.UUID))
	if !ok {
		return
	}

	// v1 仅支持 TCP(UDP 见 README TODO)
	if req.Command != cmdTCP {
		return
	}

	remote, err := net.DialTimeout("tcp", net.JoinHostPort(req.Address, strconv.Itoa(req.Port)), 10*time.Second)
	if err != nil {
		return
	}
	defer remote.Close()

	if err := stream.writeVLESSResponse(); err != nil {
		return
	}

	ctr := s.meter.For(userID)

	// 双向中继;任一方向结束即关闭两端,解除另一方向阻塞。
	var once sync.Once
	closeBoth := func() {
		once.Do(func() {
			_ = conn.Close()
			_ = remote.Close()
		})
	}

	go func() {
		meteredCopy(remote, stream, &ctr.up) // 客户端 -> 目标(上行)
		closeBoth()
	}()
	meteredCopy(stream, remote, &ctr.down) // 目标 -> 客户端(下行)
	closeBoth()
}

func main() {
	cfg := loadConfig()

	meter := NewMeter()
	users := NewUserStore(cfg)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go users.Run(ctx)
	go NewReporter(cfg, meter).Run(ctx)

	srv := &Server{
		cfg: cfg,
		upgrader: websocket.Upgrader{
			ReadBufferSize:  32 * 1024,
			WriteBufferSize: 32 * 1024,
			// TLS 与来源校验由前置平台(Northflank)负责,这里放行升级
			CheckOrigin: func(*http.Request) bool { return true },
		},
		users: users,
		meter: meter,
	}

	mux := http.NewServeMux()
	mux.HandleFunc(cfg.WSPath, srv.handleWS)
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	})

	httpServer := &http.Server{
		Addr:              cfg.Listen,
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = httpServer.Shutdown(shutdownCtx)
	}()

	logf("node-core 启动:listen=%s path=%s panel=%s node=%d", cfg.Listen, cfg.WSPath, cfg.PanelBase, cfg.NodeID)
	if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("HTTP 服务退出: %v", err)
	}
}

// ─────────────────────────── 小工具 ───────────────────────────

func getenv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func getdur(key string, def time.Duration) time.Duration {
	if v := os.Getenv(key); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return def
}

func logf(format string, args ...any) {
	log.Printf(format, args...)
}
