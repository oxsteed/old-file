// client/src/components/registration/StepBar.tsx
// Minimal step progress bar — 2 segments with label + count

import { useTranslation } from 'react-i18next';

interface Props {
  current: 1 | 2;
  labels?: [string, string];
}

export default function StepBar({ current, labels }: Props) {
  const { t } = useTranslation();
  const resolvedLabels = labels ?? [t('register.step1Label'), t('register.step2Label')];

  return (
    <div className="px-6 pt-5">
      {/* Segment bars */}
      <div className="flex gap-2">
        <div
          className={`flex-1 h-[3px] rounded-full transition-all duration-400 ${
            current === 1 ? 'bg-orange-500' : 'bg-orange-500/50'
          }`}
        />
        <div
          className={`flex-1 h-[3px] rounded-full transition-all duration-400 ${
            current === 2 ? 'bg-orange-500' : 'bg-gray-700'
          }`}
        />
      </div>

      {/* Label row */}
      <div className="flex items-center justify-between mt-3">
        <span className="text-[11px] font-medium tracking-widest uppercase text-gray-400">
          {resolvedLabels[current - 1]}
        </span>
        <span className="text-[11px] text-gray-500">
          {t('register.stepOf', { current })}
        </span>
      </div>
    </div>
  );
}
