import styles from "./card.module.css";

type CardProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  children?: React.ReactNode;
};

export function Card({ eyebrow, title, description, children }: CardProps) {
  return (
    <section className={styles.card}>
      {eyebrow ? <p className={styles.eyebrow}>{eyebrow}</p> : null}
      <h3 className={styles.title}>{title}</h3>
      {description ? <p className={styles.description}>{description}</p> : null}
      {children ? <div className={styles.body}>{children}</div> : null}
    </section>
  );
}
