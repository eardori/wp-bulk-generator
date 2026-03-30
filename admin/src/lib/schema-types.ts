// ─── Business Type to Schema @type Mapping ─────────────────────────────────

export const BUSINESS_TYPES = {
  restaurant: { label: "음식점", schemaType: "Restaurant" },
  cafe: { label: "카페", schemaType: "CafeOrCoffeeShop" },
  dermatology: { label: "피부과", schemaType: "MedicalBusiness" },
  dentist: { label: "치과", schemaType: "Dentist" },
  beauty_salon: { label: "미용실/헤어", schemaType: "BeautySalon" },
  nail_salon: { label: "네일샵", schemaType: "NailSalon" },
  education: { label: "학원/교육", schemaType: "EducationalOrganization" },
  fitness: { label: "헬스/피트니스", schemaType: "SportsActivityLocation" },
  local_business: { label: "일반 로컬 비즈니스", schemaType: "LocalBusiness" },
} as const;

export type BusinessTypeKey = keyof typeof BUSINESS_TYPES;

// ─── Opening Hours ──────────────────────────────────────────────────────────

export const DAYS_OF_WEEK = [
  { key: "Monday", label: "월" },
  { key: "Tuesday", label: "화" },
  { key: "Wednesday", label: "수" },
  { key: "Thursday", label: "목" },
  { key: "Friday", label: "금" },
  { key: "Saturday", label: "토" },
  { key: "Sunday", label: "일" },
] as const;

export type DayOfWeek = (typeof DAYS_OF_WEEK)[number]["key"];

export interface OpeningHoursEntry {
  days: DayOfWeek[];
  opens: string; // "HH:mm"
  closes: string; // "HH:mm"
}

// ─── Price Range ────────────────────────────────────────────────────────────

export const PRICE_RANGES = [
  { value: "₩", label: "₩ — 저렴" },
  { value: "₩₩", label: "₩₩ — 보통" },
  { value: "₩₩₩", label: "₩₩₩ — 고급" },
  { value: "₩₩₩₩", label: "₩₩₩₩ — 프리미엄" },
] as const;

// ─── Dynamic List Items ─────────────────────────────────────────────────────

export interface MenuItem {
  name: string;
  price: string;
}

export interface ServiceItem {
  name: string;
  description: string;
}

export interface CourseItem {
  name: string;
  audience: string;
}

export interface FaqItem {
  question: string;
  answer: string;
}

// ─── Input Form Data ────────────────────────────────────────────────────────

export interface SchemaFormData {
  // Common fields
  businessType: BusinessTypeKey;
  businessName: string;
  address: string;
  phone: string;
  websiteUrl: string;
  imageUrl: string;
  openingHours: OpeningHoursEntry[];
  priceRange: string;
  acceptsReservations: boolean;
  description: string;

  // Restaurant / Cafe
  cuisineType: string;
  menuItems: MenuItem[];

  // Medical (Dermatology, Dentist)
  medicalSpecialty: string;
  services: ServiceItem[];

  // Education
  courses: CourseItem[];

  // Fitness
  amenities: string;

  // Beauty / Nail
  beautyServices: ServiceItem[];

  // FAQ
  faqItems: FaqItem[];

  // Geo coordinates (optional manual input)
  latitude: string;
  longitude: string;
}

// ─── Output ─────────────────────────────────────────────────────────────────

export interface SchemaOutput {
  businessSchema: Record<string, unknown>;
  faqSchema: Record<string, unknown> | null;
}

// ─── Initial Form Data ──────────────────────────────────────────────────────

export function createInitialFormData(): SchemaFormData {
  return {
    businessType: "restaurant",
    businessName: "",
    address: "",
    phone: "",
    websiteUrl: "",
    imageUrl: "",
    openingHours: [
      {
        days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
        opens: "09:00",
        closes: "18:00",
      },
    ],
    priceRange: "",
    acceptsReservations: false,
    description: "",
    cuisineType: "",
    menuItems: [{ name: "", price: "" }],
    medicalSpecialty: "",
    services: [{ name: "", description: "" }],
    courses: [{ name: "", audience: "" }],
    amenities: "",
    beautyServices: [{ name: "", description: "" }],
    faqItems: [{ question: "", answer: "" }],
    latitude: "",
    longitude: "",
  };
}
