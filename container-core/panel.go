package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// TrafficRecord 面板 /ws/agent 上报里的单条流量记录。
type TrafficRecord struct {
	UserID    int    `json:"userId"`
	Direction string `json:"direction"` // uplink | downlink
	Value     int64  `json:"value"`     // 字节增量
}

// ─────────────────────────── 用户表同步 ───────────────────────────

// UserStore 缓存本节点的有效用户:uuid -> userId,定期从面板拉取。
type UserStore struct {
	cfg Config
	hc  *http.Client

	mu sync.RWMutex
	m  map[string]int
}

func NewUserStore(cfg Config) *UserStore {
	return &UserStore{
		cfg: cfg,
		hc:  &http.Client{Timeout: 15 * time.Second},
		m:   make(map[string]int),
	}
}

// Lookup 按 uuid 查 userId。
func (us *UserStore) Lookup(uuid string) (int, bool) {
	us.mu.RLock()
	defer us.mu.RUnlock()
	id, ok := us.m[strings.ToLower(uuid)]
	return id, ok
}

func (us *UserStore) Count() int {
	us.mu.RLock()
	defer us.mu.RUnlock()
	return len(us.m)
}

func (us *UserStore) sync() error {
	req, err := http.NewRequest(http.MethodGet, us.cfg.PanelBase+"/api/agent/users", nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+us.cfg.AgentToken)

	resp, err := us.hc.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("user sync http %d", resp.StatusCode)
	}

	var body struct {
		Users []struct {
			UserID int    `json:"userId"`
			UUID   string `json:"uuid"`
		} `json:"users"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return err
	}

	next := make(map[string]int, len(body.Users))
	for _, u := range body.Users {
		if u.UUID != "" && u.UserID > 0 {
			next[strings.ToLower(u.UUID)] = u.UserID
		}
	}

	us.mu.Lock()
	us.m = next
	us.mu.Unlock()
	return nil
}

// Run 立即同步一次,然后按间隔周期同步,直到 ctx 取消。
func (us *UserStore) Run(ctx context.Context) {
	if err := us.sync(); err != nil {
		logf("用户表首次同步失败: %v", err)
	} else {
		logf("用户表已同步: %d 个用户", us.Count())
	}
	t := time.NewTicker(us.cfg.UserSyncInterval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			if err := us.sync(); err != nil {
				logf("用户表同步失败: %v", err)
			}
		}
	}
}

// ─────────────────────────── 健康/流量上报 ───────────────────────────

// Reporter 维持与面板 /ws/agent 的长连接并周期上报。
type Reporter struct {
	cfg     Config
	meter   *Meter
	coll    *Collector
	started time.Time
}

func NewReporter(cfg Config, meter *Meter) *Reporter {
	return &Reporter{cfg: cfg, meter: meter, coll: NewCollector(), started: time.Now()}
}

func reportWSURL(panelBase string) string {
	u := panelBase
	if strings.HasPrefix(u, "https://") {
		u = "wss://" + strings.TrimPrefix(u, "https://")
	} else if strings.HasPrefix(u, "http://") {
		u = "ws://" + strings.TrimPrefix(u, "http://")
	}
	return u + "/ws/agent"
}

// Run 断线自动重连。
func (r *Reporter) Run(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}
		if err := r.session(ctx); err != nil {
			logf("上报会话结束: %v", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(5 * time.Second):
		}
	}
}

func (r *Reporter) session(ctx context.Context) error {
	conn, _, err := websocket.DefaultDialer.DialContext(ctx, reportWSURL(r.cfg.PanelBase), nil)
	if err != nil {
		return err
	}
	defer conn.Close()

	var writeMu sync.Mutex
	writeJSON := func(v any) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		return conn.WriteJSON(v)
	}

	// 认证
	if err := writeJSON(map[string]any{
		"type":   "auth",
		"token":  r.cfg.AgentToken,
		"nodeId": r.cfg.NodeID,
	}); err != nil {
		return err
	}

	// 读循环:处理面板心跳 ping -> pong;连接错误时退出
	readErr := make(chan error, 1)
	go func() {
		for {
			var m map[string]any
			if err := conn.ReadJSON(&m); err != nil {
				readErr <- err
				return
			}
			if t, _ := m["type"].(string); t == "ping" {
				_ = writeJSON(map[string]any{"type": "pong"})
			}
		}
	}()

	logf("已连接面板上报通道 node=%d", r.cfg.NodeID)

	t := time.NewTicker(r.cfg.ReportInterval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case err := <-readErr:
			return err
		case <-t.C:
			mx := r.coll.Sample()
			report := map[string]any{
				"type":         "report",
				"serviceAlive": true,
				"cnReachable":  true,
				"uptime":       int(time.Since(r.started).Seconds()),
				"version":      "node-core/1.0",
				"loadAvg":      mx.LoadAvg,
				"cpuUsage":     mx.CPUPct,
				"memUsage":     map[string]any{"usagePercent": mx.MemPct},
				"diskUsage":    map[string]any{"usagePercent": mx.DiskPct},
				"netBandwidth": map[string]any{
					"rxBytes": mx.NetRxBytes,
					"txBytes": mx.NetTxBytes,
					"rxRate":  mx.NetRxRate,
					"txRate":  mx.NetTxRate,
				},
				"trafficRecords": r.meter.Drain(),
			}
			if err := writeJSON(report); err != nil {
				return err
			}
		}
	}
}
