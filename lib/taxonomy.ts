// Single source of truth for domains and topics. Lessons (topic_lessons), assessments (topic_id on generated
// questions), topic_mastery rows and the Skill Map all key off these ids, so renaming an id orphans its data.
// Topics are listed in learning order (foundations first); consumers must keep array order, never sort alphabetically. `subtopics` are concrete hints for question generation.

// order is 1-based and continuous within a domain; prerequisites lists topic ids that should be learned first.
export type TaxonomyTopic = { id: string; label: string; order: number; prerequisites?: string[]; subtopics: string[] }
export type TaxonomyDomain = { id: string; label: string; topics: TaxonomyTopic[] }

type TopicSpec = [id: string, label: string, subtopics: string[]]

const domain = (id: string, label: string, specs: TopicSpec[]): TaxonomyDomain => ({
  id,
  label,
  topics: specs.map(([topicId, topicName, subtopics], index) => ({ id: topicId, label: topicName, order: index + 1, ...(index > 0 && { prerequisites: [specs[index - 1][0]] }), subtopics })),
})

export const DOMAINS: TaxonomyDomain[] = [
  domain('c', 'C', [
    ['types-control-flow', 'Types & control flow', ['sizeof, fixed-width types and implicit conversions', 'integer promotion and signed/unsigned conversion', 'switch fallthrough and loop edge cases', 'string handling and buffer overflows']],
    ['pointers-bounds', 'Pointers & bounds', ['array decay and sizeof on parameters', 'pointer arithmetic and bounds validation', 'function pointers and callback tables', 'validating a length field before dereferencing']],
    ['memory-lifetime', 'Memory & lifetime', ['static storage and initialization order', 'malloc/free misuse: double free and leaks', 'returning pointers to locals', 'stack vs heap lifetime and dangling pointers']],
    ['bit-operations', 'Bit operations', ['masking, shifting and sign extension', 'set/clear/toggle idioms and atomicity of read-modify-write', 'bit manipulation for register fields', 'bitfield portability pitfalls']],
    ['struct-layout', 'Struct layout', ['struct padding, alignment and packing', 'reordering members to shrink a struct', 'offsetof and wire-format structs', 'casting byte buffers to packed structs']],
    ['volatile-mmio', 'Volatile & MMIO', ['volatile, const and memory-mapped registers', 'compiler reordering and missing volatile', 'read-to-clear status registers', 'memory barriers around device access']],
    ['preprocessor-linkage', 'Preprocessor & linkage', ['static, linkage and the preprocessor', 'macro side effects and do-while(0)', 'include guards and header ordering', 'extern, inline and one-definition rules']],
    ['undefined-behavior', 'Undefined behavior', ['uninitialized reads and unspecified evaluation order', 'signed overflow and shift UB', 'undefined behavior and strict aliasing', 'what the optimizer may assume']],
    ['interrupts-concurrency', 'Interrupts & concurrency', ['ISR-safe code and shared flags', 'critical sections and atomicity', 'race between main loop and ISR', 'reentrancy and priority inversion']],
  ]),
  domain('cpp', 'C++', [
    ['core-language', 'Core language', ['enum class, auto and uniform initialization', 'references vs pointers and overload resolution', 'const-correctness and mutable', 'rule of three/five/zero']],
    ['raii-lifetime', 'RAII & lifetime', ['RAII and object lifetime', 'temporaries and dangling references', 'destructor order and exception safety', 'scope guards for hardware resources']],
    ['smart-pointers-ownership', 'Smart pointers & ownership', ['unique_ptr vs shared_ptr ownership', 'raw pointers as non-owning observers', 'custom deleters for handles', 'weak_ptr and reference cycles']],
    ['move-semantics', 'Move semantics', ['move semantics and value categories', 'std::move vs std::forward', 'moved-from object state', 'copy elision and return value optimization']],
    ['polymorphism-virtual', 'Polymorphism & virtual', ['virtual dispatch and object slicing', 'virtual destructors', 'vtable cost on constrained targets', 'override/final and interface design']],
    ['templates-constexpr', 'Templates & constexpr', ['templates and constexpr in embedded code', 'template argument deduction pitfalls', 'compile-time lookup tables', 'static_assert and type traits']],
    ['stl-algorithms', 'STL & algorithms', ['std::array, span and string_view', 'choosing a container for fixed memory', 'iterator invalidation', 'std::algorithm and lambda captures']],
    ['embedded-cpp-constraints', 'Embedded C++ constraints', ['RTTI and code-size costs', 'exceptions vs error codes on constrained targets', 'avoiding heap allocation (static, arena, pmr)', 'static initialization order and global constructors']],
    ['concurrency', 'Concurrency', ['std::mutex and lock_guard', 'std::atomic and memory ordering', 'data races on shared state', 'condition variables and spurious wakeups']],
  ]),
  domain('linux', 'Linux', [
    ['shell-files', 'Shell & files', ['hard vs symbolic links', 'quoting, globbing and exit codes', 'filesystems, mounts and inodes', 'find, grep and text pipelines']],
    ['permissions', 'Permissions', ['permissions, capabilities and setuid', 'umask and default modes', 'sticky bit and directory permissions', 'least privilege for services']],
    ['processes-signals', 'Processes & signals', ['processes, fork/exec and zombies', 'signals and safe handlers', 'process groups and job control', 'exit status and wait']],
    ['fd-pipes-ipc', 'File descriptors, pipes & IPC', ['file descriptors, pipes and redirection', 'dup2 and descriptor inheritance across exec', 'unix domain sockets and shared memory', 'poll/select on pipes']],
    ['system-calls', 'System calls', ['mmap, open flags and O_CLOEXEC', 'syscall vs library call boundary', 'errno and short reads/writes', 'EINTR handling']],
    ['memory-virtual', 'Virtual memory', ['memory: virtual memory, OOM killer, cgroups', 'page faults and demand paging', 'RSS vs virtual size', 'swap, overcommit and cgroup limits']],
    ['scheduling-realtime', 'Scheduling & real-time', ['scheduling, priorities and real-time policies', 'SCHED_FIFO starvation', 'CPU affinity and isolation', 'priority inversion and latency sources']],
    ['systemd', 'systemd', ['systemd units and service ordering', 'Requires vs Wants vs After', 'journalctl and restart policies', 'targets, timers and sockets activation']],
    ['debugging-tools', 'Debugging tools', ['strace/ltrace/gdb debugging workflow', 'reading a core dump backtrace', 'perf, top and /proc inspection', 'valgrind and sanitizers']],
    ['kernel-modules-dmesg', 'Kernel modules & dmesg', ['kernel modules and dmesg diagnosis', 'insmod/modprobe and dependencies', 'reading an oops or panic', 'module parameters and sysfs']],
  ]),
  domain('networking', 'Networking', [
    ['tcp-ip-model', 'TCP/IP model', ['MTU, fragmentation and MSS', 'what each header carries', 'encapsulation and layer responsibilities', 'where a given tool operates in the stack']],
    ['addressing-subnetting', 'Addressing & subnetting', ['CIDR and subnet masks', 'broadcast and network addresses', 'private ranges and link-local addresses', 'choosing a subnet size']],
    ['arp-routing', 'ARP & routing', ['ARP, routing tables and default gateways', 'longest-prefix match', 'same-subnet vs gateway delivery', 'asymmetric routes and ARP failures']],
    ['udp', 'UDP', ['checksums and datagram size limits', 'multicast and broadcast', 'application-level sequencing and retries', 'UDP framing and packet loss handling']],
    ['tcp-reliability', 'TCP reliability', ['TCP handshake, retransmission and timeouts', 'sequence numbers and ACKs', 'congestion and flow control windows', 'connection teardown and TIME_WAIT']],
    ['sockets-io-models', 'Sockets & I/O models', ['bind, listen, accept order', 'partial send/recv handling', 'sockets: blocking, non-blocking, epoll', 'SO_REUSEADDR and socket options']],
    ['wire-format-endianness', 'Wire format & endianness', ['endianness and wire-format parsing', 'htons/ntohl usage', 'length-prefixed framing and bounds checks', 'struct packing vs serialization']],
    ['dns-dhcp', 'DNS & DHCP', ['DNS resolution failures', 'DHCP lease exchange', 'resolv.conf and search domains', 'caching and TTL effects']],
    ['nat-firewall', 'NAT & firewall', ['NAT, firewalls and conntrack', 'port forwarding rules', 'stateful vs stateless filtering', 'iptables/nftables rule ordering']],
    ['packet-diagnosis', 'Packet diagnosis', ['tcpdump/Wireshark trace reading', 'spotting retransmissions and resets', 'capture filters', 'ping, traceroute and ss for triage']],
    ['tls', 'TLS', ['TLS handshake failures and certificate checks', 'certificate chains and trust stores', 'SNI and hostname verification', 'protocol versions and cipher negotiation']],
  ]),
  domain('bsp', 'BSP', [
    ['cross-compilation-toolchain', 'Cross-compilation & toolchain', ['target triplets and ABI flags', 'cross-compilation, toolchains and rootfs images', 'sysroot and library search paths', 'building and inspecting for the wrong architecture']],
    ['boot-sequence', 'Boot sequence', ['boot flow: ROM, SPL, bootloader, kernel', 'where each stage loads the next', 'boot media and fallback order', 'early console and boot logs']],
    ['u-boot', 'U-Boot', ['U-Boot environment and boot commands', 'loading kernel, DTB and initramfs', 'bootargs and root selection', 'saveenv and environment storage']],
    ['linker-memory-map', 'Linker scripts & memory maps', ['memory map and MMIO access from drivers', 'sections, LMA vs VMA and startup copy', 'placing code in specific regions', 'reading a map file']],
    ['device-tree', 'Device tree', ['device tree nodes, reg and address-cells', 'compatible strings and driver binding', 'status, overlays and phandles', 'interrupts and clocks properties']],
    ['gpio-pinmux', 'GPIO & pinmux', ['pin muxing and GPIO configuration', 'active-low signals and pull resistors', 'gpiod vs legacy sysfs', 'debugging a pin that does not toggle']],
    ['i2c-spi', 'I2C & SPI', ['I2C/SPI bus bring-up and debugging', 'I2C addressing and NACKs', 'SPI modes, clock phase and chip select', 'logic analyzer traces']],
    ['interrupt-controller', 'Interrupt controller', ['interrupt controllers and IRQ mapping', 'edge vs level triggering', 'interrupt-parent and irq specifiers in DT', 'threaded IRQs and shared lines']],
    ['drivers', 'Driver model', ['character device and sysfs interface', 'kernel driver probe and platform devices', 'probe deferral and resource ordering', 'devm_ resource management']],
    ['dma-cache', 'DMA & cache', ['DMA buffers and coherency', 'cache maintenance and bounce buffers', 'physical vs bus addresses', 'alignment requirements for DMA']],
    ['clock-power', 'Clocks & power', ['enabling clocks before register access', 'clock trees and power domains', 'regulators and sequencing', 'suspend/resume and runtime PM']],
    ['board-bring-up', 'Board bring-up', ['UART console and minimal boot', 'first power-on checklist', 'DDR initialization and memory test', 'isolating hardware vs software faults']],
  ]),
  domain('qnx', 'QNX', [
    ['microkernel-architecture', 'Microkernel architecture', ['QNX Neutrino microkernel vs monolithic kernel', 'what lives in the kernel: threads, scheduling, IPC, timers, interrupt redirection', 'procnto and user-space services such as drivers and filesystems', 'fault isolation and restarting a failed driver']],
    ['message-passing', 'Message passing IPC', ['MsgSend, MsgReceive and MsgReply and the blocked states they cause', 'channels and connections (ChannelCreate, ConnectAttach)', 'send/receive/reply semantics and priority inheritance through messages', 'pulses and asynchronous notification']],
    ['scheduling-priorities', 'Scheduling & priorities', ['priority-based preemptive scheduling: FIFO, round-robin, sporadic', 'priority ranges and limits for unprivileged processes', 'priority inversion and priority inheritance', 'adaptive partitioning and CPU budgets']],
    ['threads-synchronization', 'Threads & synchronization', ['pthread mutexes, condition variables and semaphores', 'reading thread states with pidin', 'mutex protocols and priority inheritance', 'deadlock diagnosis']],
    ['processes-memory', 'Processes & memory', ['process address spaces and MMU protection', 'shared memory with shm_open and mmap', 'locking memory (mlock) for real-time paths', 'spawn vs fork and what a child inherits']],
    ['interrupts-timers', 'Interrupts & timers', ['InterruptAttach vs InterruptAttachEvent', 'what an ISR may and may not do', 'clock period, timers and timer events', 'interrupt latency and scheduling jitter']],
    ['resource-managers', 'Resource managers', ['the resource manager framework and the pathname space', 'iofunc handlers: io_read, io_write and devctl', 'OCB and attribute structures', 'threading and dispatch in a resource manager']],
    ['boot-startup', 'Boot & startup', ['IPL, startup program and procnto handoff', 'boot image (IFS) and buildfile contents', 'startup scripts and launching services', 'BSP layout and board bring-up']],
    ['networking-io-pkt', 'Networking stack', ['the network stack as a resource manager (io-pkt / io-sock)', 'interface configuration with ifconfig and drivers', 'Qnet transparent distributed networking', 'diagnosing with nicinfo and netstat']],
    ['filesystems-storage', 'Filesystems & storage', ['QNX6 power-safe filesystem and flash filesystems', 'mounting and the pathname space', 'block drivers and devb', 'fsync and data integrity on power loss']],
    ['debugging-tracing', 'Debugging & tracing', ['pidin, hogs and slog2info', 'kernel event tracing with tracelogger and the System Profiler', 'gdb, qconn and core dumps with dumper', 'finding CPU hogs and priority inversion']],
    ['safety-availability', 'Safety & availability', ['safety-certified QNX variants and what certification does and does not cover', 'adaptive partitioning vs hypervisor isolation', 'watchdogs and the High Availability Manager', 'freedom from interference']],
  ]),
]

export const DOMAIN_IDS = DOMAINS.map((entry) => entry.id)

export const findDomain = (domainId: string) => DOMAINS.find((entry) => entry.id === domainId)
export const findTopic = (domainId: string, topicId: string) => findDomain(domainId)?.topics.find((topic) => topic.id === topicId)

// Loose input (slug, spaced or mixed case) -> canonical id, or null when the topic is not in the taxonomy.
export function normalizeTopicId(domainId: string, raw: string): string | null {
  const slug = raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return findTopic(domainId, slug)?.id ?? null
}

export const isValidTopicId = (domainId: string, topicId: string) => findTopic(domainId, topicId) !== undefined

export function topicLabel(domainId: string, topicId: string) {
  return findTopic(domainId, topicId)?.label ?? topicId.replaceAll('-', ' ')
}
