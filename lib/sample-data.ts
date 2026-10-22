import type { HomeAttempt, HomeDomain, HomeRecommendation } from '@/app/sections/home-section'
import type { AssessmentQuestion, PracticeActivity } from '@/app/sections/practice-section'
import type { ClaudeState } from '@/lib/app-types'
import { findTopic } from '@/lib/taxonomy'

export const SAMPLE_ACTIVITY: PracticeActivity = {
  id: 'sample-parser-debug-01',
  domain_id: 'c',
  topic_id: 'pointers-bounds',
  domain: 'C',
  topic: 'Repair a corrupted packet parser',
  pack_version: 'v1.0.0',
  level_band: 'Intermediate',
  format: 'debug_code',
  prerequisites: ['c/types-control-flow', 'networking/packet-diagnosis'],
  estimated_duration_minutes: 25,
  learning_objectives: ['Validate a fixed header before reading fields.', 'Compare a declared payload length with bytes remaining after the header.', 'Explain why zero-length payloads are valid.'],
  prompt: 'A sensor gateway intermittently crashes while parsing UDP packets. Repair the parser without changing the wire format, and explain the validation order you chose.',
  constraints: ['Reject truncated headers safely.', 'Do not allocate heap memory.', 'Preserve valid zero-length payloads.', 'Treat every length field as untrusted input.'],
  starter_files: [
    { path: 'parser.c', content: 'int parse_packet(const uint8_t *buf, size_t len) {\n  /* repair this parser */\n}' },
    { path: 'parser.h', content: 'typedef struct { uint16_t length; } packet_header_t;' },
    { path: 'test_parser.c', content: '/* public and boundary tests */' },
  ],
  execution_profile: { runtime: 'e2b', language: 'C11', allowed_actions: ['compile', 'run public tests', 'address sanitizer'], time_limit_seconds: 12, network: 'disabled' },
  test_plan: [
    { name: 'Public functional tests', purpose: 'Valid packets and ordinary truncation cases.', visibility: 'public' },
    { name: 'Boundary length tests', purpose: 'Header-only, zero payload, and exact-boundary buffers.', visibility: 'hidden' },
    { name: 'AddressSanitizer', purpose: 'Detect out-of-bounds reads without exposing hidden cases.', visibility: 'hidden' },
  ],
  rubric: [
    { criterion: 'Header boundary validation', weight: 3, evidence: 'Proves the complete header exists before dereference.' },
    { criterion: 'Payload boundary validation', weight: 4, evidence: 'Compares payload length to remaining bytes.' },
    { criterion: 'Reasoning and safety', weight: 3, evidence: 'Explains untrusted length handling and safe failure.' },
  ],
}

export const EMPTY_ACTIVITY: PracticeActivity = {
  id: null, domain_id: null, topic_id: null, domain: null, topic: null, pack_version: null, level_band: null, format: null, prerequisites: [], estimated_duration_minutes: 15, learning_objectives: [], prompt: null, constraints: [], starter_files: [], execution_profile: { runtime: 'none', language: null, allowed_actions: [], time_limit_seconds: 0, network: 'unavailable' }, test_plan: [], rubric: [],
}

export const SAMPLE_HINTS = [
  { stage: 1, label: 'conceptual nudge', content: 'Before reading any header field, prove that the buffer contains the complete header.', revealed: true },
  { stage: 2, label: 'focused clue', content: 'The payload begins after the header. Validate the declared length against len minus the header size.', revealed: false },
  { stage: 3, label: 'pseudocode or command outline', content: 'if len < sizeof(header), reject; remaining = len - sizeof(header); if declared > remaining, reject.', revealed: false },
  { stage: 4, label: 'explained solution', content: 'Dereference only after the header check, then validate the payload against the remaining bytes. A zero-length payload is safe when the header is complete.', revealed: false },
]

export const SAMPLE_DOMAINS: HomeDomain[] = [
  { id: 'c', label: 'C', score: 64, level: 'Intermediate', confidence: 0.78, focus: 'Bounds validation and memory safety', isReal: false },
  { id: 'cpp', label: 'C++', score: 43, level: 'Foundation', confidence: 0.68, focus: 'RAII and object lifetime', isReal: false },
  { id: 'linux', label: 'Linux', score: 71, level: 'Advanced', confidence: 0.81, focus: 'Processes, signals, and debugging', isReal: false },
  { id: 'networking', label: 'Networking', score: 51, level: 'Intermediate', confidence: 0.73, focus: 'Packet diagnosis and sockets', isReal: false },
  { id: 'bsp', label: 'BSP', score: 28, level: 'Basic', confidence: 0.47, focus: 'Boot flow and device trees', isReal: false },
  { id: 'qnx', label: 'QNX', score: 36, level: 'Foundation', confidence: 0.52, focus: 'Message passing and priorities', isReal: false },
]

// Real taxonomy topic each sample domain card focuses on (used for sample coverage and sample skill-map rows).
export const SAMPLE_FOCUS_TOPIC: Record<string, string> = { c: 'pointers-bounds', cpp: 'raii-lifetime', linux: 'processes-signals', networking: 'packet-diagnosis', bsp: 'boot-sequence', qnx: 'message-passing' }
export const sampleFocusTopicId = (domainId: string) => { const id = SAMPLE_FOCUS_TOPIC[domainId]; return id && findTopic(domainId, id) ? id : '' }

export const SAMPLE_ATTEMPTS: HomeAttempt[] = [
  { id: 'sample-tcp', title: 'Trace a failed TCP handshake', chip: 'Networking', meta: 'Scenario', status: 'Passed', tone: 'good', scoreLabel: null, when: 'example', whenFull: '', isReal: false },
  { id: 'sample-raii', title: 'Review unsafe ownership', chip: 'C++', meta: 'Code review', status: 'Partial', tone: 'warn', scoreLabel: null, when: 'example', whenFull: '', isReal: false },
  { id: 'sample-boot', title: 'Read a bootloader handoff trace', chip: 'BSP', meta: 'Log analysis', status: 'Passed', tone: 'good', scoreLabel: null, when: 'example', whenFull: '', isReal: false },
]

export const SAMPLE_RECOMMENDATION: HomeRecommendation = {
  title: 'Repair a corrupted packet parser',
  description: 'Find and fix three memory-safety defects in a C parser handling variable-length network frames.',
  domain: 'C', topic: 'Pointers & bounds', level: 'Intermediate', format: 'Debugging', duration: 25,
  rationale: 'Your last two attempts showed strong pointer arithmetic but inconsistent bounds validation.', isReal: false,
}

export const SAMPLE_QUESTIONS: AssessmentQuestion[] = [
  { stem: 'Before reading a length field from an untrusted packet buffer, what must be proven first?', options: ['The complete fixed header fits in the buffer', 'The payload has a non-zero length', 'The buffer can be copied to the heap'], type: 'single_answer' },
  { stem: 'Which signals can be used to request a process to reload configuration without terminating it?', options: ['SIGHUP', 'SIGTERM', 'SIGKILL', 'SIGUSR1'], type: 'multiple_answer' },
  { stem: 'A TCP client retransmits after a timeout. Which evidence would best distinguish a routing issue from application slowness?', options: ['Packet capture with SYN/SYN-ACK timing', 'The client variable names', 'A larger receive buffer alone'], type: 'single_answer', artifact: 'client → SYN → gateway → ? → server' },
  { stem: 'A device-tree node names a UART but the boot log shows no mapped register range. What is the most useful next check?', options: ['Compare reg and address-cells against the SoC memory map', 'Increase the baud rate immediately', 'Disable all interrupts'], type: 'single_answer' },
  { stem: 'Which evidence is sufficient to claim a generated embedded fix is safe for production hardware?', options: ['A passing local unit test', 'Human review plus hardware-specific validation', 'A confident explanation from the coach'], type: 'single_answer' },
]

export const SAMPLE_CLAUDE: ClaudeState = {
  available: true,
  status: 'ready',
  notice: 'The AI CLI runs on the Linux host with its existing login. No Lyzr API is used for tutoring requests.',
  job_id: null,
  exit_code: null,
  stdout: '',
  stderr: '',
  changed_files: [],
}

export const concealHints = (list: typeof SAMPLE_HINTS) => list.map((hint) => ({ ...hint, revealed: false }))
