import { useTranslation } from 'react-i18next';
type RenderWaitCopyProps = {
  /** Whole minutes remaining, at least 1. */
  etaMinutes: number;
  /** False after the ready email has already been sent for this sequence. */
  willEmail: boolean;
};

/**
 * Copy shown while a first-run storyboard is generating (#1276): people
 * leave the countdown unless we say they can go.
 */
export const RenderWaitCopy: React.FC<RenderWaitCopyProps> = ({
  etaMinutes,
  willEmail,
}) => {
  const { t } = useTranslation('sequences');
  return (
    <span>
      {
        <>
          {t('Rendering, about {{value1}} min.', { value1: etaMinutes })}
          {willEmail && <> {t('We’ll email you when it’s ready.')}</>}
        </>
      }
    </span>
  );
};
