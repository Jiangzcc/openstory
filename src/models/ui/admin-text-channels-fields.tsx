import { useTranslation } from 'react-i18next';
import { useLabelTranslation } from '@/ui/i18n/use-label-translation';
import { Alert, AlertDescription, AlertTitle } from '@/ui/shadcn/alert';
import { Button } from '@/ui/shadcn/button';
import { Checkbox } from '@/ui/shadcn/checkbox';
import { Input } from '@/ui/shadcn/input';
import { Label } from '@/ui/shadcn/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/shadcn/select';
import { Switch } from '@/ui/shadcn/switch';
import { Textarea } from '@/ui/shadcn/textarea';
import type { TextChannelFieldErrors } from './admin-text-channels-state';

type TextInputProps = {
  id: string;
  label: string;
  value: string;
  onChange?: (value: string) => void;
  error?: string;
  hint?: string;
  placeholder?: string;
  type?: 'text' | 'password' | 'number' | 'url';
  required?: boolean;
  readOnly?: boolean;
  min?: number;
  step?: number | 'any';
  maxLength?: number;
  autoComplete?: string;
};
type TextSelectProps = {
  id: string;
  label: string;
  value: string;
  options: { value: string; label: string; disabled?: boolean }[];
  onChange: (value: string | null) => void;
  error?: string;
  hint?: string;
  disabled?: boolean;
};
type TextToggleProps = {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  switchControl?: boolean;
  disabled?: boolean;
};

function FieldHelp({
  id,
  hint,
  error,
}: {
  id: string;
  hint?: string;
  error?: string;
}) {
  const translate = useLabelTranslation('admin');
  return (
    <>
      {hint && (
        <p id={id + '-hint'} className="text-sm text-muted-foreground">
          {translate(hint)}
        </p>
      )}
      {error && (
        <p id={id + '-error'} className="text-sm text-destructive" role="alert">
          {translate(error)}
        </p>
      )}
    </>
  );
}

function describedBy(id: string, hint?: string, error?: string) {
  return (
    [hint && id + '-hint', error && id + '-error'].filter(Boolean).join(' ') ||
    undefined
  );
}

export function AdminTextInput(props: TextInputProps) {
  const translate = useLabelTranslation('admin');
  const {
    id,
    label,
    hint,
    placeholder,
    error,
    value,
    onChange,
    required = true,
    ...input
  } = props;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Label htmlFor={id}>{translate(label)}</Label>
      <Input
        {...input}
        id={id}
        placeholder={
          placeholder === undefined ? undefined : translate(placeholder)
        }
        value={value}
        required={required}
        onChange={(event) => onChange?.(event.target.value)}
        aria-invalid={!!error}
        aria-describedby={describedBy(id, hint, error)}
        className="min-h-11 md:min-h-8"
        spellCheck={false}
      />
      <FieldHelp id={id} hint={hint} error={error} />
    </div>
  );
}

export function AdminTextSelect(props: TextSelectProps) {
  const { t } = useTranslation('admin');
  const translate = useLabelTranslation('admin');
  const { id, label, value, options, onChange, hint, error, disabled } = props;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Label htmlFor={id}>{translate(label)}</Label>
      <Select
        value={value || null}
        items={options}
        onValueChange={onChange}
        required
        disabled={disabled}
      >
        <SelectTrigger
          id={id}
          className="min-h-11 w-full md:min-h-8"
          aria-invalid={!!error}
          aria-describedby={describedBy(id, hint, error)}
        >
          <SelectValue placeholder={t('Choose an option')} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem
              key={option.value}
              value={option.value}
              disabled={option.disabled}
            >
              <span className="break-all whitespace-normal">
                {option.label}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FieldHelp id={id} hint={hint} error={error} />
    </div>
  );
}

export function AdminTextToggle(props: TextToggleProps) {
  const translate = useLabelTranslation('admin');
  const { id, label, hint, checked, onChange, switchControl, disabled } = props;
  return (
    <div className="flex min-h-11 items-start gap-3">
      <div className="mt-0.5 flex min-h-5 items-center">
        {switchControl ? (
          <Switch
            id={id}
            disabled={disabled}
            checked={checked}
            onCheckedChange={onChange}
          />
        ) : (
          <Checkbox
            id={id}
            disabled={disabled}
            checked={checked}
            onCheckedChange={(value) => onChange(value === true)}
          />
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <Label htmlFor={id} className="min-h-5 leading-5">
          {translate(label)}
        </Label>
        {hint && (
          <p className="text-sm text-muted-foreground">{translate(hint)}</p>
        )}
      </div>
    </div>
  );
}

export function AdminTextDescription(props: {
  value: string;
  error?: string;
  onChange: (value: string) => void;
  maxLength: number;
}) {
  const { t } = useTranslation('admin');
  const id = 'text-model-description';
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Label htmlFor={id}>{t('Description (optional)')}</Label>
      <Textarea
        id={id}
        value={props.value}
        maxLength={props.maxLength}
        rows={3}
        onChange={(event) => props.onChange(event.target.value)}
        aria-invalid={!!props.error}
        aria-describedby={describedBy(id, undefined, props.error)}
      />
      <FieldHelp id={id} error={props.error} />
    </div>
  );
}

type EditorFeedbackProps = {
  errors: TextChannelFieldErrors;
  saveError: Error | null;
  isStale: boolean;
  onRefresh: () => void;
  isRefreshing: boolean;
};

export function AdminTextEditorFeedback(props: EditorFeedbackProps) {
  const { t } = useTranslation('admin');
  const translate = useLabelTranslation('admin');
  return (
    <div className="flex flex-col gap-3" aria-live="polite">
      {props.errors.form && (
        <Alert variant="destructive">
          <AlertTitle>{translate(props.errors.form)}</AlertTitle>
        </Alert>
      )}
      {props.saveError && <TextSaveFailure {...props} />}
      {props.isStale && (
        <Alert>
          <AlertTitle>{t('Saved configuration changed')}</AlertTitle>
          <AlertDescription>
            <p>
              {t(
                'Reload the saved configuration and review your draft before saving again.'
              )}
            </p>
            <Button
              type="button"
              variant="outline"
              onClick={props.onRefresh}
              disabled={props.isRefreshing}
            >
              {t('Reload configuration')}
            </Button>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

function TextSaveFailure(props: EditorFeedbackProps) {
  const { t } = useTranslation('admin');
  const translate = useLabelTranslation('admin');
  if (!props.saveError) return null;
  return (
    <Alert variant="destructive">
      <AlertTitle>{t('Could not save changes.')}</AlertTitle>
      <AlertDescription className="break-words">
        <p>{translate(props.saveError.message)}</p>
        <p>{t('Your draft is still in the form. Review it and try again.')}</p>
        {!props.isStale && (
          <Button
            type="button"
            variant="outline"
            onClick={props.onRefresh}
            disabled={props.isRefreshing}
          >
            {t('Reload configuration')}
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}

export function AdminTextEditorActions(props: {
  isSaving: boolean;
  disabled: boolean;
  onClose: () => void;
  label: string;
}) {
  const { t } = useTranslation('admin');
  const translate = useLabelTranslation('admin');
  return (
    <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
      <Button
        type="button"
        variant="ghost"
        onClick={props.onClose}
        disabled={props.isSaving}
      >
        {t('Cancel')}
      </Button>
      <Button type="submit" disabled={props.isSaving || props.disabled}>
        {props.isSaving ? t('Saving…') : translate(props.label)}
      </Button>
    </div>
  );
}
