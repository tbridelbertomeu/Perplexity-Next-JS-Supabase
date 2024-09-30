/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // Prevent bundling of 'undici' on the client-side
      config.resolve.alias['undici'] = false;
    }
    return config;
  },
};

module.exports = nextConfig;
