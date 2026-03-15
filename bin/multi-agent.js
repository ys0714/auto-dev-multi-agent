#!/usr/bin/env node

// Ensure environment variables are loaded
require('dotenv').config({ override: true });

// Run the built typescript application
require('../dist/index.js');
