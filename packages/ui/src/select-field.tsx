import styles from "./select-field.module.css";

type Option = {
  label: string;
  value: string;
};

type SelectFieldProps = {
  label: string;
  value?: string;
  options: Option[];
  onChange?: (value: string) => void;
  helpText?: string;
};

export function SelectField({
  label,
  value,
  options,
  onChange,
  helpText
}: SelectFieldProps) {
  return (
    <label className={styles.field}>
      <span className={styles.label}>{label}</span>
      <select
        className={styles.select}
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {helpText ? <span className={styles.help}>{helpText}</span> : null}
    </label>
  );
}
