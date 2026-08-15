import type { LiveTalkTranscript } from '@/stores/realtime-talk';

export const LIVE_TALK_TRANSCRIPT_MOCK: LiveTalkTranscript[] = [
  { role: 'user', text: '帮我规划一下今天下午的工作。', final: true },
  {
    role: 'assistant',
    text: '下午三点前完成项目周报，三点半和设计团队同步，四点预留半小时处理邮件。',
    final: true,
  },
  { role: 'user', text: '把和设计团队的同步改到四点，并提醒我提前十分钟准备。', final: true },
  { role: 'assistant', text: '已调整为下午四点同步，并会在三点五十分提醒你准备相关材料。', final: true },
  { role: 'user', text: '周报先给我一个简短大纲。', final: true },
  { role: 'assistant', text: '可以：1. 本周进展；2. 关键成果；3. 风险与阻塞；4. 下周计划。', final: true },
];
