package main

import (
	"bufio"
	"os"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

// Metrics 单次采样的系统指标。
type Metrics struct {
	LoadAvg    []float64
	MemPct     float64
	DiskPct    float64
	CPUPct     float64
	NetRxBytes uint64
	NetTxBytes uint64
	NetRxRate  float64 // bytes/s
	NetTxRate  float64 // bytes/s
}

// Collector 基于 /proc 与 statfs 采集指标,CPU/网络需要两次采样算速率。
type Collector struct {
	mu sync.Mutex

	lastCPUBusy  uint64
	lastCPUTotal uint64
	lastRx       uint64
	lastTx       uint64
	lastTime     time.Time
	inited       bool
}

func NewCollector() *Collector { return &Collector{} }

func (c *Collector) Sample() Metrics {
	c.mu.Lock()
	defer c.mu.Unlock()

	now := time.Now()
	m := Metrics{
		LoadAvg: readLoadAvg(),
		MemPct:  readMemPct(),
		DiskPct: readDiskPct("/"),
	}

	busy, total := readCPU()
	rx, tx := readNet()
	m.NetRxBytes = rx
	m.NetTxBytes = tx

	if c.inited {
		if dt := total - c.lastCPUTotal; dt > 0 {
			m.CPUPct = float64(busy-c.lastCPUBusy) / float64(dt) * 100
		}
		if secs := now.Sub(c.lastTime).Seconds(); secs > 0 {
			if rx >= c.lastRx {
				m.NetRxRate = float64(rx-c.lastRx) / secs
			}
			if tx >= c.lastTx {
				m.NetTxRate = float64(tx-c.lastTx) / secs
			}
		}
	}

	c.lastCPUBusy, c.lastCPUTotal = busy, total
	c.lastRx, c.lastTx = rx, tx
	c.lastTime = now
	c.inited = true

	return m
}

func readLoadAvg() []float64 {
	b, err := os.ReadFile("/proc/loadavg")
	if err != nil {
		return nil
	}
	f := strings.Fields(string(b))
	if len(f) < 3 {
		return nil
	}
	out := make([]float64, 3)
	for i := 0; i < 3; i++ {
		out[i], _ = strconv.ParseFloat(f[i], 64)
	}
	return out
}

func readMemPct() float64 {
	f, err := os.Open("/proc/meminfo")
	if err != nil {
		return 0
	}
	defer f.Close()
	var total, avail float64
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		fields := strings.Fields(sc.Text())
		if len(fields) < 2 {
			continue
		}
		switch fields[0] {
		case "MemTotal:":
			total, _ = strconv.ParseFloat(fields[1], 64)
		case "MemAvailable:":
			avail, _ = strconv.ParseFloat(fields[1], 64)
		}
	}
	if total <= 0 {
		return 0
	}
	return (1 - avail/total) * 100
}

func readDiskPct(path string) float64 {
	var st syscall.Statfs_t
	if err := syscall.Statfs(path, &st); err != nil {
		return 0
	}
	total := st.Blocks
	if total == 0 {
		return 0
	}
	free := st.Bavail
	return (1 - float64(free)/float64(total)) * 100
}

func readCPU() (busy, total uint64) {
	f, err := os.Open("/proc/stat")
	if err != nil {
		return 0, 0
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := sc.Text()
		if !strings.HasPrefix(line, "cpu ") {
			continue
		}
		fields := strings.Fields(line)[1:]
		var idle uint64
		for i, s := range fields {
			v, _ := strconv.ParseUint(s, 10, 64)
			total += v
			if i == 3 || i == 4 { // idle + iowait
				idle += v
			}
		}
		busy = total - idle
		return busy, total
	}
	return 0, 0
}

func readNet() (rx, tx uint64) {
	f, err := os.Open("/proc/net/dev")
	if err != nil {
		return 0, 0
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := sc.Text()
		idx := strings.IndexByte(line, ':')
		if idx < 0 {
			continue
		}
		iface := strings.TrimSpace(line[:idx])
		if iface == "lo" {
			continue
		}
		fields := strings.Fields(line[idx+1:])
		if len(fields) < 9 {
			continue
		}
		r, _ := strconv.ParseUint(fields[0], 10, 64)
		t, _ := strconv.ParseUint(fields[8], 10, 64)
		rx += r
		tx += t
	}
	return rx, tx
}
