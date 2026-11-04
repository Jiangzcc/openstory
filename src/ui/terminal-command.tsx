import { useLiveTranslation } from '@/ui/i18n/use-live-translation';
import { useTranslation } from 'react-i18next';
/**
 * Terminal block from Skills & MCP (`/connect`). One copy button for every line.
 */
import { copyTextToClipboard } from '@/ui/clipboard';
import { Button } from '@/ui/shadcn/button';
import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

export function Terminal({
  label,
  comment,
  lines,
  prompt = true,
}: {
  label: string;
  comment?: string;
  lines: readonly string[];
  prompt?: boolean;
}) {
  const translateEvent = useLiveTranslation('interface');
  const { t } = useTranslation('interface');

  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!(await copyTextToClipboard(lines.join('\n')))) {
      toast.error(translateEvent('Could not copy'), {
        description: translateEvent('Select it and copy.'),
      });
      return;
    }
    setCopied(true);
    toast.success(translateEvent('Copied'));
  };

  return (
    <div className="flex flex-col rounded-lg border bg-muted/50">
      <div className="flex items-center gap-3 border-b px-3 py-1">
        <div className="flex gap-1.5" aria-hidden>
          <span className="size-2.5 rounded-full bg-muted-foreground/30" />
          <span className="size-2.5 rounded-full bg-muted-foreground/30" />
          <span className="size-2.5 rounded-full bg-muted-foreground/30" />
        </div>
        <span className="flex-1 font-mono text-xs tracking-wide text-muted-foreground uppercase">
          {label}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t('Copy {{value1}}', { value1: label })}
          onClick={() => void copy()}
        >
          {copied ? <Check /> : <Copy />}
        </Button>
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-sm">
        {comment && (
          <span className="text-muted-foreground">{`# ${comment}\n`}</span>
        )}
        {lines.map((line, i) => (
          <span key={`${i}:${line}`}>
            {prompt && <span className="text-muted-foreground">❯ </span>}
            {i < lines.length - 1 ? `${line}\n` : line}
          </span>
        ))}
      </pre>
    </div>
  );
}
