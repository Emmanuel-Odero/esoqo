/**
 * ResponsiveOnboardingForm Example & Reference Implementation
 *
 * This file demonstrates how to use the ResponsiveOnboardingForm component
 * for different onboarding flows. It includes:
 * - Business registration onboarding
 * - User profile completion
 * - Seller setup wizard
 */

import React, { useState } from "react";
import ResponsiveOnboardingForm, {
  FormSection,
  FormField,
  ResponsiveOnboardingFormProps,
} from "./ResponsiveOnboardingForm";

// ============================================================================
// Example 1: Business Registration Onboarding
// ============================================================================

/**
 * This example mimics Stripe's business setup flow.
 * Sections are organized by user intent (who, what, where, etc.)
 */
export function BusinessRegistrationOnboarding() {
  const [submitted, setSubmitted] = useState(false);

  const sections: FormSection[] = [
    {
      id: "business-info",
      title: "About Your Business",
      description: "Help us understand what you do",
      columns: "auto",
      fields: [
        {
          id: "business_name",
          name: "businessName",
          label: "Business Name",
          type: "text",
          placeholder: "e.g., Acme Foods Ltd",
          required: true,
          description: "The official name of your business",
          helpText: "This will appear on all transactions",
          validate: (value) => {
            if (!value) return undefined;
            if (value.length < 2)
              return "Business name must be at least 2 characters";
            if (value.length > 100)
              return "Business name must be 100 characters or less";
            return undefined;
          },
        },
        {
          id: "business_type",
          name: "businessType",
          label: "Business Type",
          type: "select",
          required: true,
          placeholder: "Select your business type",
          options: [
            { value: "sole-trader", label: "Sole Trader" },
            { value: "partnership", label: "Partnership" },
            { value: "pvt-ltd", label: "Private Limited Company" },
            { value: "cooperative", label: "Cooperative" },
            { value: "ngo", label: "Non-Governmental Organization" },
            { value: "other", label: "Other" },
          ],
          helpText: "We use this to offer relevant features",
        },
        {
          id: "industry",
          name: "industry",
          label: "Industry",
          type: "select",
          required: true,
          placeholder: "Select your industry",
          options: [
            { value: "agriculture", label: "Agriculture" },
            { value: "food-retail", label: "Food Retail" },
            { value: "logistics", label: "Logistics" },
            { value: "manufacturing", label: "Manufacturing" },
            { value: "services", label: "Services" },
          ],
          helpText: "Help us personalize your experience",
        },
        {
          id: "employees",
          name: "employees",
          label: "Number of Employees",
          type: "number",
          placeholder: "1",
          min: 1,
          required: true,
          validate: (value) => {
            if (!value || value < 1) return "Must have at least 1 employee";
            if (value > 1000) return "Please enter a realistic number";
            return undefined;
          },
        },
      ],
    },

    {
      id: "location",
      title: "Where Are You Located?",
      description: "We'll use this for compliance and features",
      columns: "auto",
      fields: [
        {
          id: "country",
          name: "country",
          label: "Country",
          type: "select",
          required: true,
          placeholder: "Select country",
          options: [
            { value: "ke", label: "Kenya" },
            { value: "ug", label: "Uganda" },
            { value: "tz", label: "Tanzania" },
            { value: "gh", label: "Ghana" },
          ],
          helpText: "We support operations in East & West Africa",
        },
        {
          id: "county",
          name: "county",
          label: "County/Region",
          type: "text",
          placeholder: "e.g., Nairobi, Kampala",
          required: true,
          helpText: "Your primary business location",
        },
        {
          id: "city",
          name: "city",
          label: "City",
          type: "text",
          placeholder: "e.g., Nairobi",
          required: true,
        },
        {
          id: "postal_code",
          name: "postalCode",
          label: "Postal Code",
          type: "text",
          placeholder: "00100",
          required: false,
        },
      ],
    },

    {
      id: "contact",
      title: "Contact Information",
      description: "How should we reach you?",
      columns: "auto",
      fields: [
        {
          id: "contact_name",
          name: "contactName",
          label: "Contact Person Name",
          type: "text",
          placeholder: "e.g., John Doe",
          required: true,
          helpText: "Primary contact for business matters",
        },
        {
          id: "contact_email",
          name: "contactEmail",
          label: "Email Address",
          type: "email",
          placeholder: "john@acmefoods.com",
          required: true,
          validate: (value) => {
            if (!value) return undefined;
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(value)) return "Please enter a valid email";
            return undefined;
          },
        },
        {
          id: "contact_phone",
          name: "contactPhone",
          label: "Phone Number",
          type: "tel",
          placeholder: "+254 712 345 678",
          required: true,
          validate: (value) => {
            if (!value) return undefined;
            // Basic E.164 validation
            if (!/^\+?[1-9]\d{1,14}$/.test(value.replace(/\s/g, ""))) {
              return "Please enter a valid phone number";
            }
            return undefined;
          },
          helpText: "Used for important notifications",
        },
      ],
    },

    {
      id: "registration",
      title: "Business Registration",
      description: "Help us verify your business",
      columns: "auto",
      fields: [
        {
          id: "registration_number",
          name: "registrationNumber",
          label: "Business Registration Number",
          type: "text",
          placeholder: "e.g., PVT/2024/123456",
          required: true,
          helpText: "From your local business registry",
        },
        {
          id: "tax_id",
          name: "taxId",
          label: "Tax ID (PIN/TIN)",
          type: "text",
          placeholder: "e.g., A123456789B",
          required: true,
          helpText: "Your government-issued tax identifier",
        },
        {
          id: "registration_doc",
          name: "registrationDoc",
          label: "Upload Registration Certificate",
          type: "file",
          required: true,
          accept: "application/pdf,image/png,image/jpeg",
          helpText: "PDF or image of your registration certificate (max 1MB)",
        },
      ],
    },

    {
      id: "terms",
      title: "Terms & Agreements",
      description: "Please review and accept our terms",
      columns: 1,
      fields: [
        {
          id: "terms_agreed",
          name: "termsAgreed",
          label: "I agree to the Terms of Service and Privacy Policy",
          type: "checkbox",
          required: true,
          validate: (value) => {
            if (!value) return "You must agree to continue";
            return undefined;
          },
        },
        {
          id: "marketing_consent",
          name: "marketingConsent",
          label:
            "I'd like to receive updates about new features and promotions",
          type: "checkbox",
          required: false,
        },
      ],
    },
  ];

  const handleSubmit = async (formData: Record<string, any>) => {
    console.log("Form submitted:", formData);
    // Make API call here
    // await api.registerBusiness(formData);
    setSubmitted(true);
  };

  const handleCancel = () => {
    if (confirm("Are you sure you want to cancel registration?")) {
      // Navigate away
      console.log("Registration cancelled");
    }
  };

  if (submitted) {
    return (
      <div style={{ padding: "32px", textAlign: "center" }}>
        <h2>🎉 Welcome to Esoqo!</h2>
        <p>Your business has been successfully registered.</p>
        <p>You'll receive a confirmation email shortly.</p>
      </div>
    );
  }

  return (
    <ResponsiveOnboardingForm
      title="Set Up Your Business"
      description="Complete your profile to unlock all features"
      sections={sections}
      onSubmit={handleSubmit}
      onCancel={handleCancel}
      showProgress={true}
      submitLabel="Complete Setup"
      cancelLabel="Cancel"
    />
  );
}

// ============================================================================
// Example 2: Seller Profile Completion (Progressive Disclosure)
// ============================================================================

/**
 * Demonstrates progressive disclosure:
 * - Some fields only show based on previous answers
 */
export function SellerProfileCompletion() {
  const [formData, setFormData] = React.useState<Record<string, any>>({});

  const sections: FormSection[] = [
    {
      id: "seller-basics",
      title: "About You",
      columns: "auto",
      fields: [
        {
          id: "seller_name",
          name: "sellerName",
          label: "Store Name",
          type: "text",
          placeholder: "What's your store called?",
          required: true,
        },
        {
          id: "seller_type",
          name: "sellerType",
          label: "What Do You Sell?",
          type: "radio",
          required: true,
          options: [
            { value: "produce", label: "Agricultural Produce" },
            { value: "livestock", label: "Livestock" },
            { value: "processed", label: "Processed Foods" },
            { value: "mixed", label: "Mixed" },
          ],
        },
      ],
    },

    {
      id: "produce-details",
      title: "Your Products",
      description: "Tell us more about what you sell",
      columns: "auto",
      fields: [
        {
          id: "produce_types",
          name: "produceTypes",
          label: "Main Product Categories",
          type: "checkbox",
          required: true,
          // Only show if seller_type is produce or mixed
          showIf: (data) =>
            data.seller_type === "produce" || data.seller_type === "mixed",
          options: [
            { value: "grains", label: "Grains & Cereals" },
            { value: "vegetables", label: "Vegetables" },
            { value: "fruits", label: "Fruits" },
            { value: "legumes", label: "Legumes & Pulses" },
          ],
        },
        {
          id: "organic_certified",
          name: "organicCertified",
          label: "Are your products organically certified?",
          type: "radio",
          required: true,
          showIf: (data) =>
            data.seller_type === "produce" || data.seller_type === "mixed",
          options: [
            { value: "yes", label: "Yes" },
            { value: "in-progress", label: "In Progress" },
            { value: "no", label: "No" },
          ],
        },
        {
          id: "certification_doc",
          name: "certificationDoc",
          label: "Upload Certification",
          type: "file",
          required: true,
          accept: "application/pdf,image/*",
          showIf: (data) => data.organic_certified === "yes",
          helpText: "Only shown if certified",
        },
      ],
    },

    {
      id: "shipping",
      title: "Shipping & Logistics",
      columns: "auto",
      fields: [
        {
          id: "can_ship",
          name: "canShip",
          label: "Can you arrange shipping?",
          type: "radio",
          required: true,
          options: [
            { value: "yes", label: "Yes, I can handle it" },
            { value: "no", label: "No, I need help" },
          ],
        },
        {
          id: "shipping_zones",
          name: "shippingZones",
          label: "Where can you ship to?",
          type: "select",
          required: true,
          showIf: (data) => data.can_ship === "yes",
          options: [
            { value: "local", label: "Within my county" },
            { value: "national", label: "Across the country" },
            { value: "regional", label: "Across the region" },
          ],
        },
      ],
    },
  ];

  const handleSubmit = async (data: Record<string, any>) => {
    console.log("Seller profile completed:", data);
    setFormData(data);
  };

  return (
    <ResponsiveOnboardingForm
      title="Complete Your Seller Profile"
      description="Just a few more details to get started"
      sections={sections}
      onSubmit={handleSubmit}
      showProgress={true}
      submitLabel="Save & Continue"
    />
  );
}

// ============================================================================
// Example 3: Lightweight Buyer Signup (Mobile-First)
// ============================================================================

/**
 * A simpler, mobile-first flow with minimal fields
 */
export function BuyerSignup() {
  const sections: FormSection[] = [
    {
      id: "personal-info",
      title: "Create Your Account",
      columns: 1,
      fields: [
        {
          id: "full_name",
          name: "fullName",
          label: "Full Name",
          type: "text",
          required: true,
          placeholder: "Jane Doe",
        },
        {
          id: "email",
          name: "email",
          label: "Email Address",
          type: "email",
          required: true,
          placeholder: "jane@example.com",
          validate: (value) => {
            if (!value) return undefined;
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
              return "Please enter a valid email";
            }
            return undefined;
          },
        },
        {
          id: "password",
          name: "password",
          label: "Password",
          type: "text", // In production, use password field with strength meter
          required: true,
          placeholder: "At least 8 characters",
          helpText: "Must include letters, numbers, and symbols",
          validate: (value) => {
            if (!value) return undefined;
            if (value.length < 8)
              return "Password must be at least 8 characters";
            if (!/[A-Z]/.test(value)) return "Must include uppercase letter";
            if (!/[0-9]/.test(value)) return "Must include number";
            return undefined;
          },
        },
      ],
    },

    {
      id: "preferences",
      title: "Preferences",
      columns: 1,
      fields: [
        {
          id: "location",
          name: "location",
          label: "County",
          type: "select",
          required: true,
          options: [
            { value: "nairobi", label: "Nairobi" },
            { value: "mombasa", label: "Mombasa" },
            { value: "kisumu", label: "Kisumu" },
          ],
        },
        {
          id: "notifications",
          name: "notifications",
          label: "I want to receive notifications about deals",
          type: "checkbox",
          required: false,
        },
      ],
    },
  ];

  const handleSubmit = async (formData: Record<string, any>) => {
    console.log("Buyer signup:", formData);
    // Sign up buyer
  };

  return (
    <ResponsiveOnboardingForm
      title="Join Esoqo"
      description="Get access to fresh products from local farms"
      sections={sections}
      onSubmit={handleSubmit}
      showProgress={false}
      submitLabel="Create Account"
    />
  );
}

// ============================================================================
// Export Examples
// ============================================================================

export const examples = {
  businessRegistration: BusinessRegistrationOnboarding,
  sellerProfile: SellerProfileCompletion,
  buyerSignup: BuyerSignup,
};
