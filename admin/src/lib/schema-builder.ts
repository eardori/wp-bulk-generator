import type {
  SchemaFormData,
  SchemaOutput,
  MenuItem,
  ServiceItem,
  CourseItem,
  OpeningHoursEntry,
  FaqItem,
} from "./schema-types";
import { BUSINESS_TYPES } from "./schema-types";

// ─── Korean Address Parsing ─────────────────────────────────────────────────

const REGION_MAP: Record<string, string> = {
  서울: "서울특별시",
  부산: "부산광역시",
  대구: "대구광역시",
  인천: "인천광역시",
  광주: "광주광역시",
  대전: "대전광역시",
  울산: "울산광역시",
  세종: "세종특별자치시",
  경기: "경기도",
  강원: "강원특별자치도",
  충북: "충청북도",
  충남: "충청남도",
  전북: "전북특별자치도",
  전남: "전라남도",
  경북: "경상북도",
  경남: "경상남도",
  제주: "제주특별자치도",
};

interface ParsedAddress {
  region: string;
  locality: string;
  street: string;
}

export function parseKoreanAddress(address: string): ParsedAddress {
  const trimmed = address.trim();
  const parts = trimmed.split(/\s+/);

  let region = "";
  let locality = "";
  let street = "";

  if (parts.length >= 3) {
    // "서울 강남구 선릉로152길 18"
    const first = parts[0];
    region = REGION_MAP[first] || first;
    locality = parts[1];
    street = parts.slice(2).join(" ");
  } else if (parts.length === 2) {
    const first = parts[0];
    region = REGION_MAP[first] || first;
    street = parts[1];
  } else {
    street = trimmed;
  }

  return { region, locality, street };
}

// ─── Phone Formatting ───────────────────────────────────────────────────────

export function formatPhoneNumber(phone: string): string {
  const cleaned = phone.replace(/[^\d-]/g, "");
  if (cleaned.startsWith("0")) {
    return "+82-" + cleaned.substring(1);
  }
  return cleaned;
}

// ─── Sub-Schema Builders ────────────────────────────────────────────────────

function buildPostalAddress(parsed: ParsedAddress) {
  const result: Record<string, string> = {
    "@type": "PostalAddress",
    addressCountry: "KR",
  };
  if (parsed.street) result.streetAddress = parsed.street;
  if (parsed.locality) result.addressLocality = parsed.locality;
  if (parsed.region) result.addressRegion = parsed.region;
  return result;
}

function buildMenuSchema(items: MenuItem[]) {
  const validItems = items.filter((i) => i.name.trim());
  if (validItems.length === 0) return null;

  return {
    "@type": "Menu",
    hasMenuSection: {
      "@type": "MenuSection",
      name: "대표 메뉴",
      hasMenuItem: validItems.map((item) => ({
        "@type": "MenuItem",
        name: item.name,
        ...(item.price.trim()
          ? {
              offers: {
                "@type": "Offer",
                price: item.price.replace(/[^0-9]/g, ""),
                priceCurrency: "KRW",
              },
            }
          : {}),
      })),
    },
  };
}

function buildServiceSchema(items: ServiceItem[]) {
  const validItems = items.filter((i) => i.name.trim());
  if (validItems.length === 0) return null;

  return validItems.map((item) => ({
    "@type": "Service" as const,
    name: item.name,
    ...(item.description.trim()
      ? { description: item.description }
      : {}),
  }));
}

function buildCourseSchema(items: CourseItem[]) {
  const validItems = items.filter((i) => i.name.trim());
  if (validItems.length === 0) return null;

  return validItems.map((item) => ({
    "@type": "Course" as const,
    name: item.name,
    ...(item.audience.trim()
      ? { audience: { "@type": "EducationalAudience", educationalRole: item.audience } }
      : {}),
  }));
}

function buildHoursSchema(entries: OpeningHoursEntry[]) {
  return entries
    .filter((e) => e.days.length > 0 && e.opens && e.closes)
    .map((entry) => ({
      "@type": "OpeningHoursSpecification" as const,
      dayOfWeek: entry.days,
      opens: entry.opens,
      closes: entry.closes,
    }));
}

function buildFAQSchema(items: FaqItem[]) {
  const validItems = items.filter(
    (i) => i.question.trim() && i.answer.trim()
  );
  if (validItems.length === 0) return null;

  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: validItems.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer,
      },
    })),
  };
}

// ─── Main Schema Generator ──────────────────────────────────────────────────

export function generateSchema(input: SchemaFormData): SchemaOutput {
  const typeConfig = BUSINESS_TYPES[input.businessType];

  // Step 1: Base schema
  const schema: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": typeConfig.schemaType,
    name: input.businessName,
  };

  // Step 2: Description
  if (input.description.trim()) {
    schema.description = input.description;
  }

  // Step 3: Image
  if (input.imageUrl.trim()) {
    schema.image = input.imageUrl;
  }

  // Step 4: Address
  if (input.address.trim()) {
    const parsed = parseKoreanAddress(input.address);
    schema.address = buildPostalAddress(parsed);
  }

  // Step 5: Geo coordinates
  if (input.latitude.trim() && input.longitude.trim()) {
    schema.geo = {
      "@type": "GeoCoordinates",
      latitude: parseFloat(input.latitude),
      longitude: parseFloat(input.longitude),
    };
  }

  // Step 6: Contact info
  if (input.websiteUrl.trim()) {
    schema.url = input.websiteUrl;
  }
  if (input.phone.trim()) {
    schema.telephone = formatPhoneNumber(input.phone);
  }

  // Step 7: Price range
  if (input.priceRange) {
    schema.priceRange = input.priceRange;
  }

  // Step 8: Reservations
  if (input.acceptsReservations) {
    schema.acceptsReservations = true;
  }

  // Step 9: Opening hours
  if (input.openingHours.length > 0) {
    const hours = buildHoursSchema(input.openingHours);
    if (hours.length > 0) {
      schema.openingHoursSpecification = hours;
    }
  }

  // Step 10: Business-type specific extensions
  switch (input.businessType) {
    case "restaurant":
    case "cafe": {
      if (input.cuisineType.trim()) {
        schema.servesCuisine = input.cuisineType;
      }
      const menu = buildMenuSchema(input.menuItems);
      if (menu) {
        schema.hasMenu = menu;
      }
      break;
    }

    case "dermatology": {
      schema["@type"] = "MedicalBusiness";
      if (input.medicalSpecialty.trim()) {
        schema.medicalSpecialty = input.medicalSpecialty;
      }
      const services = buildServiceSchema(input.services);
      if (services) {
        schema.availableService = services;
      }
      break;
    }

    case "dentist": {
      if (input.medicalSpecialty.trim()) {
        schema.medicalSpecialty = input.medicalSpecialty;
      }
      const services = buildServiceSchema(input.services);
      if (services) {
        schema.availableService = services;
      }
      break;
    }

    case "beauty_salon":
    case "nail_salon": {
      const services = buildServiceSchema(input.beautyServices);
      if (services) {
        schema.availableService = services;
      }
      break;
    }

    case "education": {
      const courses = buildCourseSchema(input.courses);
      if (courses) {
        schema.courseOffered = courses;
      }
      break;
    }

    case "fitness": {
      if (input.amenities.trim()) {
        schema.amenityFeature = {
          "@type": "LocationFeatureSpecification",
          name: input.amenities,
        };
      }
      break;
    }

    case "local_business":
    default:
      break;
  }

  // Step 11: FAQ (separate block)
  const faqSchema = buildFAQSchema(input.faqItems);

  return { businessSchema: schema, faqSchema };
}
