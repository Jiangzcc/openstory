import type { ComponentProps, ReactNode } from 'react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { useLabelTranslation } from '@/ui/i18n/use-label-translation';
import { Input } from '@/ui/shadcn/input';
import { Label } from '@/ui/shadcn/label';
import { Textarea } from '@/ui/shadcn/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/shadcn/select';
import { Checkbox } from '@/ui/shadcn/checkbox';
import { Alert, AlertTitle, AlertDescription } from '@/ui/shadcn/alert';
import { Button } from '@/ui/shadcn/button';
import {
  imageSaveErrorMessage,
  submitImageTextareaOnShortcut,
} from './admin-image-channels-state';
import type { ImageFormIssue } from './admin-image-channels-state';

function AdminImageField(props: {
  label: string;
  hint?: string;
  id: string;
  children: ReactNode;
}) {
  const translate = useLabelTranslation('imageChannels');
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Label htmlFor={props.id}>{translate(props.label)}</Label>
      {props.children}
      {props.hint && (
        <p id={props.id + '-hint'} className="text-sm text-muted-foreground">
          {translate(props.hint)}
        </p>
      )}
    </div>
  );
}

type InputProps = Omit<ComponentProps<typeof Input>, 'id'> & {
  label: string;
  hint?: string;
};
export function AdminImageInput({ label, hint, ...input }: InputProps) {
  const id = useId();
  return (
    <AdminImageField id={id} label={label} hint={hint}>
      <Input
        {...input}
        id={id}
        aria-describedby={hint ? id + '-hint' : undefined}
        className="min-h-11 text-base"
      />
    </AdminImageField>
  );
}

export function AdminImageTextarea({
  label,
  hint,
  ...input
}: Omit<ComponentProps<typeof Textarea>, 'id'> & {
  label: string;
  hint?: string;
}) {
  const id = useId();
  return (
    <AdminImageField id={id} label={label} hint={hint}>
      <Textarea
        {...input}
        onKeyDown={submitImageTextareaOnShortcut}
        id={id}
        aria-describedby={hint ? id + '-hint' : undefined}
        className="text-base"
      />
    </AdminImageField>
  );
}

export function AdminImageSelect(props: {
  name: string;
  label: string;
  defaultValue?: string;
  value?: string;
  onValueChange?: (value: string | null) => void;
  disabled?: boolean;
  translateOptions?: boolean;
  options: readonly { value: string; label: string; disabled?: boolean }[];
}) {
  const id = useId();
  const translate = useLabelTranslation('imageChannels');
  const options = props.options.map((item) => ({
    ...item,
    label: props.translateOptions ? translate(item.label) : item.label,
  }));
  return (
    <AdminImageField id={id} label={props.label}>
      <Select
        name={props.name}
        items={options}
        required
        defaultValue={props.defaultValue}
        value={props.value}
        onValueChange={props.onValueChange}
        disabled={props.disabled}
      >
        <SelectTrigger id={id} className="min-h-11 w-full min-w-0 text-base">
          <SelectValue placeholder={translate('Choose an option')} />
        </SelectTrigger>
        <SelectContent>
          {options.map((item) => (
            <SelectItem
              key={item.value}
              value={item.value}
              disabled={item.disabled}
            >
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </AdminImageField>
  );
}

export function AdminImageCheckbox(props: {
  name: string;
  label: string;
  defaultChecked?: boolean;
  disabled?: boolean;
}) {
  const id = useId();
  const translate = useLabelTranslation('imageChannels');
  return (
    <div className="flex min-h-11 items-center gap-3">
      <Checkbox
        id={id}
        name={props.name}
        className="size-6 after:-inset-2.5"
        defaultChecked={props.defaultChecked}
        disabled={props.disabled}
      />
      <Label htmlFor={id} className="min-h-6 content-center">
        {translate(props.label)}
      </Label>
    </div>
  );
}

export function AdminImageFeedback(props: {
  issues: ImageFormIssue[];
  error: Error | null;
  stale: boolean;
  onReload: () => void;
  busy: boolean;
}) {
  const { t } = useTranslation('imageChannels');
  const translate = useLabelTranslation('imageChannels');
  return (
    <div aria-live="polite" className="flex flex-col gap-3">
      {!!props.issues.length && <ImageValidationIssues issues={props.issues} />}
      {props.error && (
        <Alert variant="destructive">
          <AlertTitle>
            {translate(imageSaveErrorMessage(props.error))}
          </AlertTitle>
          <AlertDescription>
            {t(
              'Your draft is still in the form. Reload the configuration to resolve a conflict, or review the fields and try again.'
            )}
          </AlertDescription>
        </Alert>
      )}
      {props.stale && (
        <Alert>
          <AlertTitle>{t('Saved configuration changed')}</AlertTitle>
          <AlertDescription>
            {t(
              'Reload the saved revision and review this draft before saving again.'
            )}
          </AlertDescription>
        </Alert>
      )}
      {(props.error || props.stale) && (
        <Button
          className="min-h-11 sm:min-h-8"
          type="button"
          variant="outline"
          disabled={props.busy}
          onClick={props.onReload}
        >
          {t('Reload configuration')}
        </Button>
      )}
    </div>
  );
}

function ImageValidationIssues({ issues }: { issues: ImageFormIssue[] }) {
  const { t } = useTranslation('imageChannels');
  const translate = useLabelTranslation('imageChannels');
  return (
    <Alert variant="destructive">
      <AlertTitle>{t('Check the form fields')}</AlertTitle>
      <AlertDescription>
        <ul className="flex flex-col gap-2">
          {issues.map((issue, index) => (
            <li key={issue.path + index}>
              {issue.path && <code>{issue.path}: </code>}
              {translate(issue.message)}
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}

export function AdminImageEditorActions(props: {
  saving: boolean;
  disabled: boolean;
  onCancel: () => void;
  label: string;
}) {
  const { t } = useTranslation('imageChannels');
  const translate = useLabelTranslation('imageChannels');
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <Button
        className="min-h-11 sm:min-h-8"
        type="button"
        variant="ghost"
        disabled={props.saving}
        onClick={props.onCancel}
      >
        {t('Cancel')}
      </Button>
      <Button type="submit" disabled={props.disabled}>
        {props.saving ? t('Saving…') : translate(props.label)}
      </Button>
    </div>
  );
}
