// Topic picker options shared by the Home screen and the /api/lesson route.

export const DOMAIN_TOPIC_OPTIONS = [
  { id: 'c', label: 'C', topics: [{ id: 'types-control-flow', label: 'Types & control flow' }, { id: 'pointers-bounds', label: 'Pointers & bounds' }, { id: 'memory-lifetime', label: 'Memory & lifetime' }, { id: 'bit-operations', label: 'Bit operations' }, { id: 'concurrency', label: 'Concurrency' }] },
  { id: 'cpp', label: 'C++', topics: [{ id: 'core-language', label: 'Core language' }, { id: 'raii-lifetime', label: 'RAII & lifetime' }, { id: 'stl-algorithms', label: 'STL & algorithms' }, { id: 'templates', label: 'Templates' }, { id: 'concurrency', label: 'Concurrency' }] },
  { id: 'linux', label: 'Linux', topics: [{ id: 'shell-files', label: 'Shell & files' }, { id: 'processes-signals', label: 'Processes & signals' }, { id: 'debugging-tools', label: 'Debugging tools' }, { id: 'system-calls', label: 'System calls' }, { id: 'cross-compilation', label: 'Cross-compilation' }] },
  { id: 'networking', label: 'Networking', topics: [{ id: 'tcp-ip-model', label: 'TCP/IP model' }, { id: 'addressing', label: 'Addressing & subnetting' }, { id: 'sockets', label: 'Sockets' }, { id: 'packet-diagnosis', label: 'Packet diagnosis' }, { id: 'routing-dns', label: 'Routing & DNS' }] },
  { id: 'bsp', label: 'BSP', topics: [{ id: 'boot-sequence', label: 'Boot sequence' }, { id: 'device-tree', label: 'Device tree' }, { id: 'drivers', label: 'Driver model' }, { id: 'linker-memory-map', label: 'Linker scripts & memory maps' }, { id: 'board-bring-up', label: 'Board bring-up' }] },
]

export function topicLabel(domainId: string, topicId: string) {
  return DOMAIN_TOPIC_OPTIONS.find((domain) => domain.id === domainId)?.topics.find((topic) => topic.id === topicId)?.label ?? topicId.replaceAll('-', ' ')
}
