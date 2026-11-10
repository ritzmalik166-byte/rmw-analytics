// Bundle entry for dist/tracker.js (IIFE). Boots from the <script data-site-id> tag.
import { boot } from './tracker.js';

try { boot(window); } catch (e) { /* never break the host page */ }
