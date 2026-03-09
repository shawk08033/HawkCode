import styles from "./text-field.module.css";

type TextFieldProps = {
  label: string;
  placeholder?: string;
  value?: string;
  onChange?: (value: string) => void;
  type?: "text" | "password" | "email";
  helpText?: string;
};

export function TextField({
  label,
  placeholder,
  value,
  onChange,
  type = "text",
  helpText
}: TextFieldProps) {
  return (
    <label className={styles.field}>
      <span className={styles.label}>{label}</span>
      <input
        className={styles.input}
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
      />
      {helpText ? <span className={styles.help}>{helpText}</span> : null}
    </label>
  );
}
