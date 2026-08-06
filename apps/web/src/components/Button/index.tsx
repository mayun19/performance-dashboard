import { useState } from "react";
import type {
  ButtonHTMLAttributes,
  DetailedHTMLProps,
  CSSProperties,
} from "react";

interface ButtonProps extends DetailedHTMLProps<
  ButtonHTMLAttributes<HTMLButtonElement>,
  HTMLButtonElement
> {
  // i will enhance to this variant
  /*
    primary-light
    primary-light-outlined 
    primary
    secondary 
    ghost
    */
  variant?:
    | "primary-light"
    | "primary-light-outlined"
    | "primary-outlined"
    | "grey-outlined"
    | "primary-blue-outlined"
    | "primary-blue"
    | "primary-blue-simpp"
    | "primary-grey"
    | "ghost"
    | "danger"
    | "danger-level"
    | "success"
    | "yellow";
  size?: "sm" | "regular" | "md" | "lg";
}

const baseStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  borderRadius: "12px",
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "transparent",
  backgroundColor: "transparent",
  fontWeight: 600,
  cursor: "pointer",
  transition:
    "background-color .15s ease, border-color .15s ease, color .15s ease",
  whiteSpace: "nowrap",
};

// Variant styles — backgroundColor / borderColor only, consistent with baseStyle.
const variants: Record<string, { base: CSSProperties; hover?: CSSProperties }> =
  {
    "primary-light": {
      base: {
        backgroundColor: "var(--color-accent-tint)",
        color: "var(--color-accent)",
      },
      hover: {
        backgroundColor:
          "var(--color-accent-tint-strong, var(--color-accent-tint))",
      },
    },
    "primary-light-outlined": {
      base: {
        backgroundColor: "transparent",
        color: "var(--color-accent)",
        borderColor: "var(--color-accent)",
      },
      hover: { backgroundColor: "var(--color-accent-tint)" },
    },
    "primary-blue-outlined": {
      base: {
        backgroundColor: "transparent",
        color: "var(--color-surface)",
        borderColor: "var(--color-accent)",
      },
      hover: { backgroundColor: "var(--color-accent-tint)" },
    },
    "primary-blue": {
      base: {
        backgroundColor: "var(--color-brand-hover)",
        color: "var(--color-surface)",
      },
      hover: {
        backgroundColor: "var(--color-border)",
      },
    },
    "primary-grey": {
      base: {
        backgroundColor: "#E1F3F6",
        color: "#6B7280",
      },
      hover: { backgroundColor: "var(--color-border)" },
    },
    "primary-blue-simpp": {
      base: { backgroundColor: "var(--color-accent)", color: "#fff" },
      hover: {
        backgroundColor: "var(--color-accent-strong, var(--color-accent))",
      },
    },
    "primary-outlined": {
      base: {
        backgroundColor: "transparent",
        color: "var(--color-text)",
        borderColor: "var(--color-border)",
      },
      hover: { backgroundColor: "var(--color-surface-2)" },
    },
    "grey-outlined": {
      base: {
        backgroundColor: "transparent",
        color: "var(--color-text-muted)",
        borderColor: "var(--color-border)",
      },
      hover: { backgroundColor: "var(--color-surface-2)" },
    },
    ghost: {
      base: {
        backgroundColor: "transparent",
        color: "var(--color-text-muted)",
        textDecoration: "underline",
        borderColor: "transparent",
      },
      hover: { color: "var(--color-text)" },
    },
    danger: {
      base: { backgroundColor: "var(--color-danger)", color: "#fff" },
      hover: {
        backgroundColor: "var(--color-danger-strong, var(--color-danger))",
      },
    },
    "danger-level": {
      base: {
        backgroundColor: "var(--color-danger-tint)",
        color: "var(--color-danger)",
      },
      hover: { backgroundColor: "var(--color-danger-tint)" },
    },
    success: {
      base: { backgroundColor: "var(--color-success)", color: "#fff" },
      hover: {
        backgroundColor: "var(--color-success-strong, var(--color-success))",
      },
    },
    yellow: {
      base: { backgroundColor: "#FBA806", color: "#fff" },
      hover: { backgroundColor: "#e09600" },
    },
  };

const sizes: Record<string, CSSProperties> = {
  sm: { padding: "4px 10px", fontSize: "var(--text-sm)" },
  regular: { padding: "8px 16px", fontSize: "var(--text-sm)" },
  md: { padding: "10px 18px", fontSize: "var(--text-md)" },
  lg: { padding: "12px 22px", fontSize: "var(--text-lg)" },
};

// Longhand-only, consistent with baseStyle — only ever overrides backgroundColor/borderColor.
const disabledStyle: CSSProperties = {
  backgroundColor: "var(--color-surface-2, #f3f4f6)",
  color: "var(--color-text-subtle, #9ca3af)",
  borderColor: "transparent",
  cursor: "not-allowed",
  pointerEvents: "auto",
};

const Button: React.FC<ButtonProps> = (props) => {
  const {
    variant = "primary-blue",
    size = "regular",
    type = "button",
    style,
    disabled,
    onMouseEnter,
    onMouseLeave,
    ...rest
  } = props;

  const [hovered, setHovered] = useState(false);
  const v = variants[variant] ?? variants["primary-blue"];

  const computedStyle: CSSProperties = {
    ...baseStyle,
    ...sizes[size],
    ...v.base,
    ...(hovered && !disabled ? v.hover : {}),
    ...(disabled ? disabledStyle : {}),
    ...style, // caller-supplied style always wins — must also use backgroundColor/borderColor, not background/border
  };

  return (
    <button
      {...rest}
      type={type}
      disabled={disabled}
      style={computedStyle}
      onMouseEnter={(e) => {
        setHovered(true);
        onMouseEnter?.(e);
      }}
      onMouseLeave={(e) => {
        setHovered(false);
        onMouseLeave?.(e);
      }}
    />
  );
};

export default Button;