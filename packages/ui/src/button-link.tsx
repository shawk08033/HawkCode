import styles from "./button.module.css";

type ButtonLinkProps = {
  label: string;
  href: string;
  variant?: "solid" | "ghost" | "outline";
};

export function ButtonLink({ label, href, variant = "solid" }: ButtonLinkProps) {
  const className = `${styles.base} ${styles[variant]}`.trim();
  return (
    <a className={className} href={href}>
      {label}
    </a>
  );
}
