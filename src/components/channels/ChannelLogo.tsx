import { CHANNEL_ICONS, CHANNEL_NAMES, type ChannelType } from '@/types/channel';
import { cn } from '@/lib/utils';
import telegramIcon from '@/assets/channels/telegram.svg';
import discordIcon from '@/assets/channels/discord.svg';
import whatsappIcon from '@/assets/channels/whatsapp.svg';
import wechatIcon from '@/assets/channels/wechat.svg';
import dingtalkIcon from '@/assets/channels/dingtalk.svg';
import feishuIcon from '@/assets/channels/feishu.svg';
import wecomIcon from '@/assets/channels/wecom.svg';
import qqIcon from '@/assets/channels/qq.svg';

const logos: Partial<Record<ChannelType, string>> = {
  telegram: telegramIcon, discord: discordIcon, whatsapp: whatsappIcon,
  wechat: wechatIcon, dingtalk: dingtalkIcon, feishu: feishuIcon,
  wecom: wecomIcon, qqbot: qqIcon,
};

export function ChannelLogo({ type, className }: { type: string; className?: string }) {
  const icon = logos[type as ChannelType];
  if (icon) return <img src={icon} alt="" aria-hidden="true" className={cn('h-5 w-5 shrink-0 object-contain dark:invert', className)} />;
  return <span aria-hidden="true" title={CHANNEL_NAMES[type as ChannelType] || type} className={cn('inline-flex h-5 w-5 shrink-0 items-center justify-center text-base', className)}>{CHANNEL_ICONS[type as ChannelType] || '💬'}</span>;
}
