/**
 * Tool Registry - Maps tool names to AnySite REST API endpoints
 *
 * Each tool definition includes:
 * - endpoint: The REST API path
 * - method: HTTP method (all are POST for AnySite)
 * - requiredParams: Parameters that must be provided
 * - optionalParams: Parameters that can be provided
 * - description: Human-readable description for logging/debugging
 */

const TOOL_REGISTRY = {
  // ===========================================================================
  // LINKEDIN - PROFILES & USERS
  // ===========================================================================
  'get_linkedin_profile': {
    endpoint: '/api/linkedin/profile',
    method: 'POST',
    requiredParams: ['user'],
    optionalParams: ['with_experience', 'with_education', 'with_skills', 'timeout'],
    description: 'Get LinkedIn profile data'
  },
  'search_linkedin_users': {
    endpoint: '/api/linkedin/users/search',
    method: 'POST',
    requiredParams: ['count'],
    optionalParams: ['keywords', 'first_name', 'last_name', 'title', 'company', 'location', 'industry', 'timeout'],
    description: 'Search for LinkedIn users'
  },
  'get_linkedin_user_posts': {
    endpoint: '/api/linkedin/user/posts',
    method: 'POST',
    requiredParams: ['urn'],
    optionalParams: ['count', 'timeout'],
    description: 'Get posts from a LinkedIn user'
  },

  // ===========================================================================
  // LINKEDIN - COMPANIES
  // ===========================================================================
  'get_linkedin_company': {
    endpoint: '/api/linkedin/company',
    method: 'POST',
    requiredParams: ['company'],
    optionalParams: ['timeout'],
    description: 'Get LinkedIn company data'
  },
  'get_linkedin_company_posts': {
    endpoint: '/api/linkedin/company/posts',
    method: 'POST',
    requiredParams: ['urn'],
    optionalParams: ['count', 'timeout'],
    description: 'Get posts from a LinkedIn company'
  },
  'search_linkedin_companies': {
    endpoint: '/api/linkedin/companies/search',
    method: 'POST',
    requiredParams: ['count'],
    optionalParams: ['keywords', 'location', 'industry', 'company_size', 'timeout'],
    description: 'Search for LinkedIn companies'
  },
  'get_linkedin_company_employees': {
    endpoint: '/api/linkedin/company/employees',
    method: 'POST',
    requiredParams: ['company', 'count'],
    optionalParams: ['keywords', 'title', 'timeout'],
    description: 'Get employees of a LinkedIn company'
  },

  // ===========================================================================
  // LINKEDIN - POSTS & ENGAGEMENT
  // ===========================================================================
  'search_linkedin_posts': {
    endpoint: '/api/linkedin/posts/search',
    method: 'POST',
    requiredParams: ['count'],
    optionalParams: ['keywords', 'sort', 'date_posted', 'authors', 'author_industries', 'author_title', 'content_type', 'mentioned', 'timeout'],
    description: 'Search for LinkedIn posts'
  },
  'get_linkedin_post': {
    endpoint: '/api/linkedin/post',
    method: 'POST',
    requiredParams: ['urn'],
    optionalParams: ['include_all_document_images', 'timeout'],
    description: 'Get a specific LinkedIn post'
  },
  'get_linkedin_post_comments': {
    endpoint: '/api/linkedin/post/comments',
    method: 'POST',
    requiredParams: ['urn', 'count'],
    optionalParams: ['sort', 'timeout'],
    description: 'Get comments on a LinkedIn post'
  },
  'get_linkedin_post_reactions': {
    endpoint: '/api/linkedin/post/reactions',
    method: 'POST',
    requiredParams: ['urn', 'count'],
    optionalParams: ['timeout'],
    description: 'Get reactions on a LinkedIn post'
  },

  // ===========================================================================
  // LINKEDIN - GROUPS
  // ===========================================================================
  'get_linkedin_group': {
    endpoint: '/api/linkedin/group',
    method: 'POST',
    requiredParams: ['group'],
    optionalParams: ['timeout'],
    description: 'Get LinkedIn group data'
  },

  // ===========================================================================
  // INSTAGRAM
  // ===========================================================================
  'get_instagram_user': {
    endpoint: '/api/instagram/user',
    method: 'POST',
    requiredParams: ['user'],
    optionalParams: ['timeout'],
    description: 'Get Instagram user profile'
  },
  'get_instagram_user_posts': {
    endpoint: '/api/instagram/user/posts',
    method: 'POST',
    requiredParams: ['user', 'count'],
    optionalParams: ['timeout'],
    description: 'Get posts from an Instagram user'
  },
  'get_instagram_post': {
    endpoint: '/api/instagram/post',
    method: 'POST',
    requiredParams: ['post'],
    optionalParams: ['timeout'],
    description: 'Get a specific Instagram post'
  },
  'get_instagram_post_comments': {
    endpoint: '/api/instagram/post/comments',
    method: 'POST',
    requiredParams: ['post', 'count'],
    optionalParams: ['timeout'],
    description: 'Get comments on an Instagram post'
  },
  'get_instagram_post_likes': {
    endpoint: '/api/instagram/post/likes',
    method: 'POST',
    requiredParams: ['post', 'count'],
    optionalParams: ['timeout'],
    description: 'Get likes on an Instagram post'
  },
  'search_instagram_posts': {
    endpoint: '/api/instagram/posts/search',
    method: 'POST',
    requiredParams: ['query', 'count'],
    optionalParams: ['timeout'],
    description: 'Search for Instagram posts'
  },
  'get_instagram_user_followers': {
    endpoint: '/api/instagram/user/followers',
    method: 'POST',
    requiredParams: ['user', 'count'],
    optionalParams: ['timeout'],
    description: 'Get followers of an Instagram user'
  },
  'get_instagram_user_following': {
    endpoint: '/api/instagram/user/following',
    method: 'POST',
    requiredParams: ['user', 'count'],
    optionalParams: ['timeout'],
    description: 'Get accounts an Instagram user follows'
  },

  // ===========================================================================
  // TWITTER / X
  // ===========================================================================
  'get_twitter_user': {
    endpoint: '/api/twitter/user',
    method: 'POST',
    requiredParams: ['user'],
    optionalParams: ['timeout'],
    description: 'Get Twitter/X user profile'
  },
  'get_twitter_user_tweets': {
    endpoint: '/api/twitter/user/tweets',
    method: 'POST',
    requiredParams: ['user', 'count'],
    optionalParams: ['timeout'],
    description: 'Get tweets from a Twitter/X user'
  },
  'search_twitter_posts': {
    endpoint: '/api/twitter/posts/search',
    method: 'POST',
    requiredParams: ['query', 'count'],
    optionalParams: ['timeout'],
    description: 'Search for Twitter/X posts'
  },
  'get_twitter_post': {
    endpoint: '/api/twitter/post',
    method: 'POST',
    requiredParams: ['post'],
    optionalParams: ['timeout'],
    description: 'Get a specific Twitter/X post'
  },
  'get_twitter_user_followers': {
    endpoint: '/api/twitter/user/followers',
    method: 'POST',
    requiredParams: ['user', 'count'],
    optionalParams: ['timeout'],
    description: 'Get followers of a Twitter/X user'
  },
  'get_twitter_user_following': {
    endpoint: '/api/twitter/user/following',
    method: 'POST',
    requiredParams: ['user', 'count'],
    optionalParams: ['timeout'],
    description: 'Get accounts a Twitter/X user follows'
  },

  // ===========================================================================
  // REDDIT
  // ===========================================================================
  'search_reddit_posts': {
    endpoint: '/api/reddit/posts/search',
    method: 'POST',
    requiredParams: ['query', 'count'],
    optionalParams: ['subreddit', 'sort', 'time_filter', 'timeout'],
    description: 'Search for Reddit posts'
  },
  'get_reddit_post': {
    endpoint: '/api/reddit/post',
    method: 'POST',
    requiredParams: ['post_url'],
    optionalParams: ['timeout'],
    description: 'Get a specific Reddit post'
  },
  'get_reddit_post_comments': {
    endpoint: '/api/reddit/post/comments',
    method: 'POST',
    requiredParams: ['post_url'],
    optionalParams: ['count', 'sort', 'timeout'],
    description: 'Get comments on a Reddit post'
  },
  'get_reddit_user': {
    endpoint: '/api/reddit/user',
    method: 'POST',
    requiredParams: ['user'],
    optionalParams: ['timeout'],
    description: 'Get Reddit user profile'
  },
  'get_reddit_subreddit': {
    endpoint: '/api/reddit/subreddit',
    method: 'POST',
    requiredParams: ['subreddit'],
    optionalParams: ['timeout'],
    description: 'Get subreddit information'
  },

  // ===========================================================================
  // SEC EDGAR (Financial Filings)
  // ===========================================================================
  'search_sec_companies': {
    endpoint: '/sec/search/companies',
    method: 'POST',
    requiredParams: [],
    optionalParams: ['forms', 'entityName', 'locationCodes', 'dateRange', 'count', 'timeout'],
    description: 'Search SEC EDGAR for companies'
  },
  'get_sec_document': {
    endpoint: '/sec/document',
    method: 'POST',
    requiredParams: ['url'],
    optionalParams: ['timeout'],
    description: 'Get an SEC document'
  }
};

/**
 * Get tool configuration by name
 * @param {string} toolName - Name of the tool
 * @returns {object|null} Tool configuration or null if not found
 */
function getTool(toolName) {
  return TOOL_REGISTRY[toolName] || null;
}

/**
 * Check if a tool exists
 * @param {string} toolName - Name of the tool
 * @returns {boolean}
 */
function toolExists(toolName) {
  return toolName in TOOL_REGISTRY;
}

/**
 * Validate parameters for a tool
 * @param {string} toolName - Name of the tool
 * @param {object} params - Parameters to validate
 * @returns {{ valid: boolean, missing: string[] }}
 */
function validateParams(toolName, params) {
  const tool = getTool(toolName);
  if (!tool) {
    return { valid: false, missing: [], error: `Unknown tool: ${toolName}` };
  }

  const missing = [];
  for (const param of tool.requiredParams) {
    if (params[param] === undefined || params[param] === null || params[param] === '') {
      missing.push(param);
    }
  }

  return {
    valid: missing.length === 0,
    missing
  };
}

/**
 * Get list of all available tools
 * @returns {string[]}
 */
function listTools() {
  return Object.keys(TOOL_REGISTRY);
}

/**
 * Get all tools grouped by category
 * @returns {object}
 */
function getToolsByCategory() {
  const categories = {
    'linkedin-profiles': [],
    'linkedin-companies': [],
    'linkedin-posts': [],
    'linkedin-groups': [],
    'instagram': [],
    'twitter': [],
    'reddit': [],
    'sec': []
  };

  for (const [name, config] of Object.entries(TOOL_REGISTRY)) {
    if (name.includes('linkedin')) {
      if (name.includes('company')) {
        categories['linkedin-companies'].push(name);
      } else if (name.includes('post') || name.includes('reaction') || name.includes('comment')) {
        categories['linkedin-posts'].push(name);
      } else if (name.includes('group')) {
        categories['linkedin-groups'].push(name);
      } else {
        categories['linkedin-profiles'].push(name);
      }
    } else if (name.includes('instagram')) {
      categories['instagram'].push(name);
    } else if (name.includes('twitter')) {
      categories['twitter'].push(name);
    } else if (name.includes('reddit')) {
      categories['reddit'].push(name);
    } else if (name.includes('sec')) {
      categories['sec'].push(name);
    }
  }

  return categories;
}

module.exports = {
  TOOL_REGISTRY,
  getTool,
  toolExists,
  validateParams,
  listTools,
  getToolsByCategory
};
