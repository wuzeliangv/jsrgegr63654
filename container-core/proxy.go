package main

import (
	"io"
	"sync"
	"sync/atomic"

	"github.com/gorilla/websocket"
)

// wsStream 把 *websocket.Conn 适配成面向字节流的 io.ReadWriter。
// VLESS 帧可能跨多个 WS 消息,这里把二进制消息拼成连续字节流。
// 约束:同一时刻最多一个读者 + 一个写者(本程序的中继正好满足:
// 一个 goroutine 读 ws、另一个 goroutine 写 ws),无需额外加锁。
type wsStream struct {
	conn *websocket.Conn
	r    io.Reader // 当前 WS 消息的读取器
}

func newWSStream(c *websocket.Conn) *wsStream {
	return &wsStream{conn: c}
}

func (s *wsStream) Read(p []byte) (int, error) {
	for {
		if s.r == nil {
			mt, r, err := s.conn.NextReader()
			if err != nil {
				return 0, err
			}
			if mt != websocket.BinaryMessage && mt != websocket.TextMessage {
				continue
			}
			s.r = r
		}
		n, err := s.r.Read(p)
		if err == io.EOF {
			s.r = nil
			if n > 0 {
				return n, nil
			}
			continue
		}
		return n, err
	}
}

func (s *wsStream) Write(p []byte) (int, error) {
	if err := s.conn.WriteMessage(websocket.BinaryMessage, p); err != nil {
		return 0, err
	}
	return len(p), nil
}

// writeVLESSResponse 写回 VLESS 响应头:版本(0) + 附加信息长度(0)。
func (s *wsStream) writeVLESSResponse() error {
	return s.conn.WriteMessage(websocket.BinaryMessage, []byte{0x00, 0x00})
}

// meteredCopy 在拷贝的同时把字节数累加到计数器(原子)。
func meteredCopy(dst io.Writer, src io.Reader, ctr *int64) {
	buf := make([]byte, 32*1024)
	for {
		n, rerr := src.Read(buf)
		if n > 0 {
			atomic.AddInt64(ctr, int64(n))
			if _, werr := dst.Write(buf[:n]); werr != nil {
				return
			}
		}
		if rerr != nil {
			return
		}
	}
}

// counters 单个用户的上/下行字节增量(原子访问)。
type counters struct {
	up   int64
	down int64
}

// Meter 按 userId 累计流量增量。
type Meter struct {
	mu sync.Mutex
	m  map[int]*counters
}

func NewMeter() *Meter {
	return &Meter{m: make(map[int]*counters)}
}

func (mt *Meter) For(userID int) *counters {
	mt.mu.Lock()
	defer mt.mu.Unlock()
	c := mt.m[userID]
	if c == nil {
		c = &counters{}
		mt.m[userID] = c
	}
	return c
}

// Drain 取出自上次以来的增量并清零,转成面板上报所需的记录。
func (mt *Meter) Drain() []TrafficRecord {
	mt.mu.Lock()
	defer mt.mu.Unlock()
	var recs []TrafficRecord
	for uid, c := range mt.m {
		up := atomic.SwapInt64(&c.up, 0)
		down := atomic.SwapInt64(&c.down, 0)
		if up > 0 {
			recs = append(recs, TrafficRecord{UserID: uid, Direction: "uplink", Value: up})
		}
		if down > 0 {
			recs = append(recs, TrafficRecord{UserID: uid, Direction: "downlink", Value: down})
		}
	}
	return recs
}
