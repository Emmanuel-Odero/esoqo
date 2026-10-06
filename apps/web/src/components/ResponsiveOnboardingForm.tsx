/**
 * ResponsiveOnboardingForm
 *
 * A Stripe-inspired, responsive onboarding form component that:
 * - Maximizes available space at each breakpoint
 * - Condenses gracefully on mobile with proper whitespace
 * - Uses semantic field grouping (sections by user intent)
 * - Implements progressive disclosure (show/hide based on data)
 * - Includes real-time validation with per-field errors
 * - Maintains accessibility (WCAG 2.1 AA)
 * - Features a sticky progress rail showing completion status
 *
 * Design Principles:
 * - Desktop (1024px+): 2-column grids, maximum whitespace
 * - Tablet (640px-1023px): Mixed 1-2 column layouts
 * - Mobile (320px-639px): Single column, condensed spacing
 *
 * Breakpoints follow standard responsive design:
 * @media (min-width: 640px) - tablet
 * @media (min-width: 1024px) - desktop
 */

import React, { useState, useMemo, useCallback } from "react";
import styles from "./ResponsiveOnboardingForm.module.css";

// ============================================================================
// Types
// ============================================================================

export type FieldType =
  | "text"
  | "email"
  | "tel"
  | "number"
  | "select"
  | "textarea"
  | "checkbox"
  | "radio"
  | "file";

export type Breakpoint = "mobile" | "tablet" | "desktop";

export interface FormField {
  id: string;
  name: string;
  label: string;
  type: FieldType;
  placeholder?: string;
  required?: boolean;
  description?: string;
  helpText?: string;
  /** Show this field only if condition is met */
  showIf?: (formData: Record<string, any>) => boolean;
  /** Options for select/radio fields */
  options?: Array<{ value: string; label: string }>;
  /** Validation function returning error message or undefined */
  validate?: (value: any) => string | undefined;
  /** For file inputs: accepted file types */
  accept?: string;
  /** For number inputs: min/max bounds */
  min?: number;
  max?: number;
}

export interface FormSection {
  id: string;
  title: string;
  description?: string;
  fields: FormField[];
  /** Number of columns for this section's grid (1 or 2) */
  columns?: "auto" | 1 | 2;
}

export interface ResponsiveOnboardingFormProps {
  title: string;
  description?: string;
  sections: FormSection[];
  onSubmit: (formData: Record<string, any>) => Promise<void>;
  onCancel?: () => void;
  /** Show progress rail at top */
  showProgress?: boolean;
  /** Initial form data */
  initialData?: Record<string, any>;
  /** Custom submit button text */
  submitLabel?: string;
  cancelLabel?: string;
}

// ============================================================================
// Components
// ============================================================================

/**
 * Responsive grid container that adapts column count based on breakpoint
 * Desktop (1024px+): 2 columns
 * Tablet (640px-1023px): 1-2 columns based on field widths
 * Mobile (320px-639px): 1 column
 */
function ResponsiveGrid({
  children,
  columns = "auto",
}: {
  children: React.ReactNode;
  columns?: "auto" | 1 | 2;
}) {
  return (
    <div className={`${styles.grid} ${styles[`grid-${columns}`]}`}>
      {children}
    </div>
  );
}

/**
 * Form section with semantic grouping
 * Groups related fields under a meaningful heading
 */
function FormSectionComponent({
  section,
  formData,
  errors,
  onChange,
  onBlur,
}: {
  section: FormSection;
  formData: Record<string, any>;
  errors: Record<string, string>;
  onChange: (fieldId: string, value: any) => void;
  onBlur: (fieldId: string) => void;
}) {
  const visibleFields = section.fields.filter(
    (field) => !field.showIf || field.showIf(formData)
  );

  if (visibleFields.length === 0) {
    return null;
  }

  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <h2 className={styles.sectionTitle}>{section.title}</h2>
        {section.description && (
          <p className={styles.sectionDescription}>{section.description}</p>
        )}
      </div>

      <ResponsiveGrid columns={section.columns}>
        {visibleFields.map((field) => (
          <FormFieldComponent
            key={field.id}
            field={field}
            value={formData[field.id] ?? ""}
            error={errors[field.id]}
            onChange={(value) => onChange(field.id, value)}
            onBlur={() => onBlur(field.id)}
          />
        ))}
      </ResponsiveGrid>
    </section>
  );
}

/**
 * Individual form field with validation and error display
 * Per-field errors help users quickly find and fix problems
 */
function FormFieldComponent({
  field,
  value,
  error,
  onChange,
  onBlur,
}: {
  field: FormField;
  value: any;
  error?: string;
  onChange: (value: any) => void;
  onBlur: () => void;
}) {
  const fieldId = `field-${field.id}`;
  const errorId = `${fieldId}-error`;

  if (field.type === "textarea") {
    return (
      <div className={styles.fieldWrapper}>
        <label htmlFor={fieldId} className={styles.label}>
          {field.label}
          {field.required && <span className={styles.required}>*</span>}
        </label>
        {field.description && (
          <p className={styles.description}>{field.description}</p>
        )}
        <textarea
          id={fieldId}
          value={value}
          placeholder={field.placeholder}
          aria-invalid={error ? "true" : "false"}
          aria-describedby={error ? errorId : undefined}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          className={`${styles.input} ${styles.textarea} ${
            error ? styles.inputError : ""
          }`}
        />
        {field.helpText && (
          <p className={styles.helpText}>{field.helpText}</p>
        )}
        {error && (
          <p id={errorId} className={styles.error} role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }

  if (field.type === "select") {
    return (
      <div className={styles.fieldWrapper}>
        <label htmlFor={fieldId} className={styles.label}>
          {field.label}
          {field.required && <span className={styles.required}>*</span>}
        </label>
        {field.description && (
          <p className={styles.description}>{field.description}</p>
        )}
        <select
          id={fieldId}
          value={value}
          aria-invalid={error ? "true" : "false"}
          aria-describedby={error ? errorId : undefined}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          className={`${styles.input} ${styles.select} ${
            error ? styles.inputError : ""
          }`}
        >
          <option value="">{field.placeholder || "Select an option"}</option>
          {field.options?.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {field.helpText && (
          <p className={styles.helpText}>{field.helpText}</p>
        )}
        {error && (
          <p id={errorId} className={styles.error} role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }

  if (field.type === "checkbox") {
    return (
      <div className={styles.fieldWrapper}>
        <label className={styles.checkboxLabel}>
          <input
            id={fieldId}
            type="checkbox"
            checked={value === true}
            aria-invalid={error ? "true" : "false"}
            aria-describedby={error ? errorId : undefined}
            onChange={(e) => onChange(e.target.checked)}
            onBlur={onBlur}
            className={styles.checkbox}
          />
          <span>{field.label}</span>
        </label>
        {field.description && (
          <p className={styles.description}>{field.description}</p>
        )}
        {field.helpText && (
          <p className={styles.helpText}>{field.helpText}</p>
        )}
        {error && (
          <p id={errorId} className={styles.error} role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }

  if (field.type === "radio") {
    return (
      <div className={styles.fieldWrapper}>
        <fieldset className={styles.radioGroup}>
          <legend className={styles.label}>
            {field.label}
            {field.required && <span className={styles.required}>*</span>}
          </legend>
          {field.description && (
            <p className={styles.description}>{field.description}</p>
          )}
          {field.options?.map((opt) => (
            <label key={opt.value} className={styles.radioLabel}>
              <input
                type="radio"
                name={field.id}
                value={opt.value}
                checked={value === opt.value}
                aria-invalid={error ? "true" : "false"}
                onChange={(e) => onChange(e.target.value)}
                onBlur={onBlur}
                className={styles.radio}
              />
              <span>{opt.label}</span>
            </label>
          ))}
        </fieldset>
        {field.helpText && (
          <p className={styles.helpText}>{field.helpText}</p>
        )}
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }

  if (field.type === "file") {
    return (
      <div className={styles.fieldWrapper}>
        <label htmlFor={fieldId} className={styles.label}>
          {field.label}
          {field.required && <span className={styles.required}>*</span>}
        </label>
        {field.description && (
          <p className={styles.description}>{field.description}</p>
        )}
        <input
          id={fieldId}
          type="file"
          accept={field.accept}
          aria-invalid={error ? "true" : "false"}
          aria-describedby={error ? errorId : undefined}
          onChange={(e) => onChange(e.target.files?.[0])}
          onBlur={onBlur}
          className={`${styles.input} ${styles.fileInput} ${
            error ? styles.inputError : ""
          }`}
        />
        {field.helpText && (
          <p className={styles.helpText}>{field.helpText}</p>
        )}
        {error && (
          <p id={errorId} className={styles.error} role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }

  // Text, email, tel, number inputs
  return (
    <div className={styles.fieldWrapper}>
      <label htmlFor={fieldId} className={styles.label}>
        {field.label}
        {field.required && <span className={styles.required}>*</span>}
      </label>
      {field.description && (
        <p className={styles.description}>{field.description}</p>
      )}
      <input
        id={fieldId}
        type={field.type}
        value={value}
        placeholder={field.placeholder}
        min={field.min}
        max={field.max}
        aria-invalid={error ? "true" : "false"}
        aria-describedby={error ? errorId : undefined}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        className={`${styles.input} ${error ? styles.inputError : ""}`}
      />
      {field.helpText && (
        <p className={styles.helpText}>{field.helpText}</p>
      )}
      {error && (
        <p id={errorId} className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Progress rail showing form completion status
 * Sticky at top, updates in real-time as user fills form
 */
function ProgressRail({
  sections,
  formData,
  errors,
}: {
  sections: FormSection[];
  formData: Record<string, any>;
  errors: Record<string, string>;
}) {
  const sectionProgress = useMemo(() => {
    return sections.map((section) => {
      const visibleFields = section.fields.filter(
        (f) => !f.showIf || f.showIf(formData)
      );
      const completedFields = visibleFields.filter((f) => {
        const value = formData[f.id];
        const hasError = errors[f.id];
        return value && !hasError;
      });

      return {
        id: section.id,
        title: section.title,
        completed: completedFields.length,
        total: visibleFields.length,
        percent:
          visibleFields.length > 0
            ? (completedFields.length / visibleFields.length) * 100
            : 0,
      };
    });
  }, [sections, formData, errors]);

  const totalProgress = useMemo(() => {
    const total = sectionProgress.reduce((sum, s) => sum + s.total, 0);
    const completed = sectionProgress.reduce((sum, s) => sum + s.completed, 0);
    return total > 0 ? (completed / total) * 100 : 0;
  }, [sectionProgress]);

  return (
    <div className={styles.progressRail} role="status" aria-live="polite">
      <div className={styles.progressContainer}>
        <div className={styles.progressLabel}>
          <span className={styles.progressPercent}>{Math.round(totalProgress)}%</span>
          <span className={styles.progressText}>Complete</span>
        </div>
        <div className={styles.progressBar}>
          <div
            className={styles.progressFill}
            style={{ width: `${totalProgress}%` }}
          />
        </div>
      </div>

      <div className={styles.sectionSteps}>
        {sectionProgress.map((step) => (
          <div key={step.id} className={styles.stepIndicator}>
            <div
              className={`${styles.stepDot} ${
                step.percent === 100 ? styles.stepDotComplete : ""
              }`}
              style={{
                backgroundImage: `conic-gradient(var(--step-color, #0066cc) ${step.percent}%, var(--step-bg, #f0f0f0) ${step.percent}%)`,
              }}
              title={`${step.title}: ${step.completed}/${step.total} complete`}
            />
            <span className={styles.stepLabel}>{step.title}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export default function ResponsiveOnboardingForm({
  title,
  description,
  sections,
  onSubmit,
  onCancel,
  showProgress = true,
  initialData = {},
  submitLabel = "Continue",
  cancelLabel = "Cancel",
}: ResponsiveOnboardingFormProps) {
  const [formData, setFormData] = useState<Record<string, any>>(initialData);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Validate a single field
  const validateField = useCallback(
    (fieldId: string): string | undefined => {
      const field = sections
        .flatMap((s) => s.fields)
        .find((f) => f.id === fieldId);

      if (!field) return undefined;

      const value = formData[fieldId];

      // Check required
      if (field.required && (!value || value === "")) {
        return `${field.label} is required`;
      }

      // Run custom validation
      if (field.validate) {
        return field.validate(value);
      }

      return undefined;
    },
    [sections, formData]
  );

  // Validate all fields
  const validateForm = useCallback((): boolean => {
    const newErrors: Record<string, string> = {};

    sections.forEach((section) => {
      section.fields.forEach((field) => {
        if (!field.showIf || field.showIf(formData)) {
          const error = validateField(field.id);
          if (error) {
            newErrors[field.id] = error;
          }
        }
      });
    });

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [sections, formData, validateField]);

  // Handle field change
  const handleFieldChange = useCallback((fieldId: string, value: any) => {
    setFormData((prev) => ({
      ...prev,
      [fieldId]: value,
    }));
  }, []);

  // Handle field blur
  const handleFieldBlur = useCallback((fieldId: string) => {
    setTouched((prev) => new Set([...prev, fieldId]));

    const error = validateField(fieldId);
    setErrors((prev) => {
      if (error) {
        return { ...prev, [fieldId]: error };
      } else {
        const newErrors = { ...prev };
        delete newErrors[fieldId];
        return newErrors;
      }
    });
  }, [validateField]);

  // Handle form submission
  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();

      if (!validateForm()) {
        // Focus first error field
        const firstErrorField = Object.keys(errors)[0];
        document.getElementById(`field-${firstErrorField}`)?.focus();
        return;
      }

      setIsSubmitting(true);
      try {
        await onSubmit(formData);
      } catch (err) {
        console.error("Form submission error:", err);
        // Could set a global error state here
      } finally {
        setIsSubmitting(false);
      }
    },
    [formData, validateForm, errors, onSubmit]
  );

  return (
    <div className={styles.container}>
      {showProgress && (
        <ProgressRail sections={sections} formData={formData} errors={errors} />
      )}

      <form onSubmit={handleSubmit} className={styles.form}>
        <div className={styles.header}>
          <h1 className={styles.title}>{title}</h1>
          {description && (
            <p className={styles.description}>{description}</p>
          )}
        </div>

        <div className={styles.content}>
          {sections.map((section) => (
            <FormSectionComponent
              key={section.id}
              section={section}
              formData={formData}
              errors={errors}
              onChange={handleFieldChange}
              onBlur={handleFieldBlur}
            />
          ))}
        </div>

        <div className={styles.footer}>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              disabled={isSubmitting}
              className={`${styles.button} ${styles.buttonSecondary}`}
            >
              {cancelLabel}
            </button>
          )}
          <button
            type="submit"
            disabled={isSubmitting}
            className={`${styles.button} ${styles.buttonPrimary}`}
          >
            {isSubmitting ? "Submitting..." : submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
