import styles from "./button.module.css";

type ButtonProps = {
  label: string;
  variant?: "solid" | "ghost" | "outline";
  onClick?: () => void;
  type?: "button" | "submit" | "reset";
};

export function Button({
  label,
  variant = "solid",
  onClick,
  type = "button"
}: ButtonProps) {
  const className = `${styles.base} ${styles[variant]}`.trim();
  return (
    <button type={type} className={className} onClick={onClick}>
      {label}
    </button>
  );
}
