#!/usr/bin/env python3
import sys
from pathlib import Path

# Add the current directory to sys.path so we can import the package
sys.path.append(str(Path(__file__).parent))

from multi_auto_agent.main import main

if __name__ == "__main__":
    main()
