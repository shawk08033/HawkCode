import styles from "./landing.module.css";

type Action = {
  label: string;
  variant?: "solid" | "ghost";
  onClick?: () => void;
};

type LandingPanelProps = {
  eyebrow: string;
  title: string;
  subtitle: string;
  primaryAction: Action;
  secondaryAction?: Action;
};

export function LandingPanel({
  eyebrow,
  title,
  subtitle,
  primaryAction,
  secondaryAction
}: LandingPanelProps) {
  return (
    <main className={styles.shell}>
      <section className={styles.panel}>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.subtitle}>{subtitle}</p>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.solid}
            onClick={primaryAction.onClick}
          >
            {primaryAction.label}
          </button>
          {secondaryAction ? (
            <button
              type="button"
              className={styles.ghost}
              onClick={secondaryAction.onClick}
            >
              {secondaryAction.label}
            </button>
          ) : null}
        </div>
      </section>
    </main>
  );
}
