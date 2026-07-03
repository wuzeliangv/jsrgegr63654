package main

import (
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net"
)

// VLESS command codes
const (
	cmdTCP = 0x01
	cmdUDP = 0x02
)

// vlessRequest 解析后的 VLESS 请求头
type vlessRequest struct {
	UUID    [16]byte
	Command byte
	Address string
	Port    int
}

// parseVLESSRequest 从入站流读取并解析 VLESS 请求头。
// 线路格式(版本 0):
//	1B  版本(必须为 0)
//	16B 用户 UUID
//	1B  附加信息长度 M
//	MB  附加信息(flow 等,WS 传输通常为 0)
//	1B  指令(1=TCP,2=UDP)
//	2B  端口(大端)
//	1B  地址类型(1=IPv4,2=域名,3=IPv6)
//	..  地址
func parseVLESSRequest(r io.Reader) (*vlessRequest, error) {
	// 版本(1) + UUID(16)
	head := make([]byte, 17)
	if _, err := io.ReadFull(r, head); err != nil {
		return nil, err
	}
	if head[0] != 0x00 {
		return nil, fmt.Errorf("unsupported protocol version %d", head[0])
	}

	var req vlessRequest
	copy(req.UUID[:], head[1:17])

	var one [1]byte

	// 附加信息长度 + 跳过
	if _, err := io.ReadFull(r, one[:]); err != nil {
		return nil, err
	}
	if addonLen := int(one[0]); addonLen > 0 {
		if _, err := io.CopyN(io.Discard, r, int64(addonLen)); err != nil {
			return nil, err
		}
	}

	// 指令
	if _, err := io.ReadFull(r, one[:]); err != nil {
		return nil, err
	}
	req.Command = one[0]

	// 端口(大端)
	var portBuf [2]byte
	if _, err := io.ReadFull(r, portBuf[:]); err != nil {
		return nil, err
	}
	req.Port = int(binary.BigEndian.Uint16(portBuf[:]))

	// 地址类型 + 地址
	if _, err := io.ReadFull(r, one[:]); err != nil {
		return nil, err
	}
	switch one[0] {
	case 0x01: // IPv4
		ip := make([]byte, 4)
		if _, err := io.ReadFull(r, ip); err != nil {
			return nil, err
		}
		req.Address = net.IP(ip).String()
	case 0x02: // 域名
		var l [1]byte
		if _, err := io.ReadFull(r, l[:]); err != nil {
			return nil, err
		}
		name := make([]byte, int(l[0]))
		if _, err := io.ReadFull(r, name); err != nil {
			return nil, err
		}
		req.Address = string(name)
	case 0x03: // IPv6
		ip := make([]byte, 16)
		if _, err := io.ReadFull(r, ip); err != nil {
			return nil, err
		}
		req.Address = net.IP(ip).String()
	default:
		return nil, errors.New("invalid address type")
	}

	return &req, nil
}

// uuidString 把 16 字节 UUID 格式化为标准小写字符串(8-4-4-4-12)。
func uuidString(b [16]byte) string {
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}
