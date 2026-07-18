"use strict";
let shellStream = null;
const AGENT_IMAGE_TARGET_BYTES = 640 * 1024;
const AGENT_IMAGE_MAX_EDGES = [1400, 1200, 1024, 900, 768, 640];
const AGENT_IMAGE_QUALITIES = [0.86, 0.78, 0.70, 0.62, 0.54];
const SUPPORTED_UPLOAD_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
let quickLinks = [];
