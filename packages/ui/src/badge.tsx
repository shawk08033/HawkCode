import styles from "./badge.module.css";

type BadgeProps = {
  label: string;
  tone?: "neutral" | "success" | "warning" | "danger";
};

export function Badge({ label, tone = "neutral" }: BadgeProps) {
  const className = `${styles.base} ${styles[tone]}`.trim();
  return <span className={className}>{label}</span>;
}
