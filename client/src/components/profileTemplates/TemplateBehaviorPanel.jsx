import { ArrowRight, CheckCircle2, Sparkles } from 'lucide-react';

export default function TemplateBehaviorPanel({
  behavior,
  onPrimaryAction,
  onSecondaryAction,
  compact = false,
}) {
  if (!behavior) return null;

  return (
    <section className={compact ? 'template-behavior-panel compact' : 'template-behavior-panel'}>
      <div className="template-behavior-head">
        <div>
          <span className="template-behavior-kicker">
            <Sparkles size={16} />
            {behavior.label}
          </span>
          <h2>{behavior.headline}</h2>
          <p>{behavior.description}</p>
        </div>
        <div className="template-behavior-actions">
          <button type="button" className="template-behavior-primary" onClick={onPrimaryAction}>
            {behavior.primaryCta}
            <ArrowRight size={16} />
          </button>
          <button type="button" className="template-behavior-secondary" onClick={onSecondaryAction}>
            {behavior.secondaryCta}
          </button>
        </div>
      </div>

      <div className="template-behavior-workflow">
        {behavior.workflow?.map((step) => {
          const Icon = step.icon || CheckCircle2;
          return (
            <article key={step.title}>
              <Icon size={18} />
              <strong>{step.title}</strong>
              <p>{step.text}</p>
            </article>
          );
        })}
      </div>

      {!compact && (
        <div className="template-behavior-bottom">
          <div>
            <h3>Best setup for this mode</h3>
            <ul>
              {behavior.setup?.map((item) => (
                <li key={item}>
                  <CheckCircle2 size={15} />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3>Connected OxSteed features</h3>
            <div className="template-behavior-tags">
              {behavior.recommendedFeatures?.map((feature) => (
                <span key={feature}>{feature}</span>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
