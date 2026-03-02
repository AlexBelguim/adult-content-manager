#!/usr/bin/env python3
"""
Force rename a folder on Windows, handling locked files.
This script uses Python's shutil which can sometimes succeed where Node.js fails.
"""

import sys
import os
import shutil
import time

def force_rename(source, destination, max_retries=5):
    """
    Forcefully rename a folder with retries.
    
    Args:
        source: Source folder path
        destination: Destination folder path
        max_retries: Maximum number of retry attempts
    
    Returns:
        True if successful, False otherwise
    """
    
    # Validate paths
    if not os.path.exists(source):
        print(f"ERROR: Source folder does not exist: {source}", file=sys.stderr)
        return False
    
    if os.path.exists(destination):
        print(f"ERROR: Destination folder already exists: {destination}", file=sys.stderr)
        return False
    
    # Try multiple times with increasing delays
    for attempt in range(1, max_retries + 1):
        try:
            print(f"Attempt {attempt}/{max_retries}: Renaming {source} -> {destination}")
            
            # Use shutil.move which is more robust on Windows
            shutil.move(source, destination)
            
            print(f"SUCCESS: Renamed folder successfully")
            return True
            
        except PermissionError as e:
            print(f"Attempt {attempt} failed: PermissionError - {e}")
            if attempt < max_retries:
                delay = attempt * 1.0  # 1s, 2s, 3s, 4s, 5s
                print(f"Waiting {delay} seconds before retry...")
                time.sleep(delay)
            else:
                print(f"ERROR: All {max_retries} attempts failed", file=sys.stderr)
                print(f"The folder is locked by another process. Please:", file=sys.stderr)
                print(f"1. Close File Explorer windows", file=sys.stderr)
                print(f"2. Close any media players", file=sys.stderr)
                print(f"3. Stop the backend server", file=sys.stderr)
                return False
                
        except Exception as e:
            print(f"ERROR: Unexpected error: {type(e).__name__} - {e}", file=sys.stderr)
            return False
    
    return False


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python force_rename.py <source_path> <destination_path>")
        sys.exit(1)
    
    source_path = sys.argv[1]
    dest_path = sys.argv[2]
    
    success = force_rename(source_path, dest_path)
    sys.exit(0 if success else 1)
