// Pool the server draws from so every generated assessment covers different
// ground. The question text itself is written by Claude; only the sub-topic,
// difficulty and question type are picked here, with crypto-grade randomness.

export const DOMAIN_TOPICS: Record<string, string[]> = {
  c: [
    'pointer arithmetic and bounds validation', 'integer promotion and signed/unsigned conversion', 'volatile, const and memory-mapped registers',
    'struct padding, alignment and packing', 'undefined behavior and strict aliasing', 'stack vs heap lifetime and dangling pointers',
    'bit manipulation for register fields', 'function pointers and callback tables', 'string handling and buffer overflows', 'static, linkage and the preprocessor',
  ],
  cpp: [
    'RAII and object lifetime', 'move semantics and value categories', 'smart pointers and ownership', 'virtual dispatch and object slicing',
    'templates and constexpr in embedded code', 'exceptions vs error codes on constrained targets', 'const-correctness and mutable', 'rule of three/five/zero',
    'iterator invalidation', 'avoiding heap allocation (static, arena, pmr)',
  ],
  linux: [
    'processes, fork/exec and zombies', 'signals and safe handlers', 'file descriptors, pipes and redirection', 'permissions, capabilities and setuid',
    'systemd units and service ordering', 'memory: virtual memory, OOM killer, cgroups', 'strace/ltrace/gdb debugging workflow', 'scheduling, priorities and real-time policies',
    'kernel modules and dmesg diagnosis', 'filesystems, mounts and inodes',
  ],
  networking: [
    'TCP handshake, retransmission and timeouts', 'UDP framing and packet loss handling', 'MTU, fragmentation and MSS', 'ARP, routing tables and default gateways',
    'DNS resolution failures', 'sockets: blocking, non-blocking, epoll', 'tcpdump/Wireshark trace reading', 'NAT, firewalls and conntrack',
    'endianness and wire-format parsing', 'TLS handshake failures and certificate checks',
  ],
  bsp: [
    'boot flow: ROM, SPL, bootloader, kernel', 'device tree nodes, reg and address-cells', 'U-Boot environment and boot commands', 'interrupt controllers and IRQ mapping',
    'I2C/SPI bus bring-up and debugging', 'pin muxing and GPIO configuration', 'memory map and MMIO access from drivers', 'clock trees and power domains',
    'kernel driver probe and platform devices', 'cross-compilation, toolchains and rootfs images',
  ],
}

export const DOMAIN_ORDER = ['c', 'cpp', 'linux', 'networking', 'bsp'] as const

import { randomInt } from 'node:crypto'

export function pick<T>(items: readonly T[]): T {
  return items[randomInt(items.length)]
}

export function shuffle<T>(items: readonly T[]): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1)
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}
