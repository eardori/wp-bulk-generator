export type TargetQuestion = {
  question: string;
  intent: "recommendation" | "comparison" | "review" | "howto";
};

export type ReviewImage = {
  originalUrl: string;
  thumbnailUrl: string;
  wpMediaUrl?: string;
  wpMediaId?: number;
};

export type ProductReview = {
  id?: string;
  text: string;
  rating: number;
  images?: ReviewImage[];
  reviewerName?: string;
  purchaseOption?: string;
  date?: string;
};

export type ReviewApiParams = {
  source: "naver" | "oliveyoung" | "coupang";
  merchantNo?: string;
  originProductNo?: string;
  channelNo?: string;
  goodsNo?: string;         // Olive Young
  goodsUrl?: string;        // Olive Young - full URL
};

export type ReviewTheme = {
  keyword: string;
  sentiment: "positive" | "negative" | "neutral";
  count: number;
  sampleTexts: string[];
};

export type ReviewCollection = {
  reviews: ProductReview[];
  totalCount: number;
  averageRating: number;
  ratingDistribution: Record<string, number>; // "1"~"5" → count
  themes: ReviewTheme[];
};

export type ScrapedProduct = {
  url: string;
  title: string;
  description: string;
  price: string;
  images: string[];
  specs: Record<string, string>;
  reviews: ProductReview[];
  rating: number | null;
  reviewCount: number;
  brand: string;
  category: string;
  source: string;
  reviewApiParams?: ReviewApiParams;
};

export type SiteCredential = {
  slug: string;
  domain: string;
  title: string;
  url: string;
  admin_user: string;
  admin_pass: string;
  app_pass: string;
  server_id?: string;
  server_host?: string;
  server_user?: string;
  persona?: {
    name: string;
    age: number;
    concern: string;
    expertise: string;
    tone: string;
    bio: string;
  } | null;
};

export type GeneratedArticle = {
  id: string;
  siteSlug: string;
  siteDomain: string;
  personaName: string;
  sourceTitle: string;
  targetQuestion: string;
  title: string;
  metaTitle: string;
  metaDescription: string;
  slug: string;
  htmlContent: string;
  excerpt: string;
  category: string;
  tags: string[];
  faqSchema: FAQItem[];
  wordCount: number;
  status: "generated" | "publishing" | "published" | "error";
  publishedUrl?: string;
  publishedPostId?: number;
  error?: string;
  reviewImages?: ReviewImage[];
  usedReviewImageIndices?: Array<[number, number]>;
};

export type FAQItem = {
  question: string;
  answer: string;
};

export type ContentArticleConfig = {
  siteSlug: string;
  count: number;    // 이 페르소나로 생성할 글 수
  enabled: boolean;
};

export type ContentStep =
  | "input"
  | "scraping"
  | "scraped"
  | "fetching-reviews"
  | "reviews-ready"
  | "content-config"   // 페르소나별 갯수 선택 (NEW)
  | "selecting"
  | "generating"
  | "preview"
  | "publishing"
  | "done"
  | "manual"
  | "error";
