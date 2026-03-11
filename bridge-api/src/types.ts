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
  goodsNo?: string;
  goodsUrl?: string;
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
  ratingDistribution: Record<string, number>;
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
