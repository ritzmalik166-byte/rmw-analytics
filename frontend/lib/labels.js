import { CHANNELS } from '@rmw-analytics/shared/channels';

/** Traffic types in everyday words (the technical channel name stays available as a hint). */
const CHANNEL_FRIENDLY = {
  direct: 'Direct',
  organic_search: 'Search engines',
  paid_search: 'Paid search ads',
  organic_social: 'Social media',
  paid_social: 'Paid social ads',
  email: 'Email',
  referral: 'Other websites',
  ai_assistant: 'AI assistants',
  display: 'Display ads',
  affiliate: 'Affiliates',
  internal: 'Internal',
};
const CHANNEL_HINT = {
  direct: 'Typed your address, used a bookmark or an app link',
  organic_search: 'Unpaid results on Google, Bing and others',
  paid_search: 'Clicked a search ad (Google Ads, Bing Ads)',
  organic_social: 'Facebook, Instagram, LinkedIn, WhatsApp, YouTube…',
  paid_social: 'Clicked a paid social media ad',
  email: 'Clicked a link in an email or newsletter',
  referral: 'Clicked a link on another website',
  ai_assistant: 'ChatGPT, Perplexity, Gemini, Claude…',
  display: 'Banner and display ads',
  affiliate: 'Affiliate partner links',
};
export const channelLabel = (v) => CHANNEL_FRIENDLY[v] || CHANNELS[v] || v || 'Unknown';
export const channelHint = (v) => CHANNEL_HINT[v] || null;

/** One-sentence explanations for metric tooltips. */
export const HELP = {
  visitors: 'People who visited and actually engaged (stayed 10+ seconds, viewed 2+ pages or converted), like Google Analytics "active users".',
  allVisitors: 'Every distinct person (browser) that opened your website, including quick visits.',
  newVisitors: 'People visiting for the first time in this period.',
  returningVisitors: 'People who had visited before.',
  sessions: 'A visit: one continuous period someone spent on your website. It ends after 30 minutes of inactivity.',
  engagedSessions: 'Visits where someone stayed 10+ seconds, viewed 2+ pages or converted.',
  pageviews: 'How many times pages were opened, including repeat views.',
  engagement: 'Average time each visitor actively spent on your website (tab open and in use).',
  avgSession: 'Average length of a visit, from the first to the last page opened.',
  pagesPerSession: 'Average number of pages opened in one visit.',
  leads: 'Enquiries captured from your forms.',
  conversions: 'Times visitors completed an action you count as valuable (a goal), such as submitting a form or tapping WhatsApp.',
  conversionRate: 'Share of visits in which at least one goal was completed.',
  exitRate: 'Share of this page\'s views that were the last page of a visit.',
  bounceRate: 'Share of visits that left quickly without engaging.',
  formConversion: 'Share of people who saw the form and submitted it.',
  abandoned: 'People who started filling the form but left without submitting.',
  failed: 'Times a visitor tried to submit and the browser showed a validation error.',
};
