#!/usr/bin/env python3
"""
CLI wrapper for MemSavr
Outputs JSON progress for Electron IPC communication
"""

import sys
import os
import json
import argparse

# Add the script directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import process_snapchat_memories as processor

def json_output(msg_type, data):
    """Print JSON message for Electron to parse"""
    output = {"type": msg_type, **data}
    print(json.dumps(output), flush=True)

def progress_callback(progress):
    """Called by processor to report progress"""
    if isinstance(progress, tuple):
        count, total = progress
        json_output("progress", {"count": count, "total": total})
    else:
        json_output("progress", {"percent": progress})

def main():
    parser = argparse.ArgumentParser(description='MemSavr CLI')
    parser.add_argument('--zip', help='Path to mydata.zip file')
    parser.add_argument('--output', help='Output directory')
    parser.add_argument('--limit', type=int, help='Limit number of memories to process')
    parser.add_argument('--pause-batches', action='store_true', help='Pause between batches for cloud sync')
    parser.add_argument('--trust-manifest', action='store_true', help='Trust manifest for resume (skip filesystem checks)')
    parser.add_argument('--retry-report', help='Path to detailed_report.json to retry failed entries')
    
    args = parser.parse_args()
    
    # Handle retry from report
    if args.retry_report:
        if not args.output:
            parser.error("--output is required with --retry-report")
        
        try:
            print(f"Loading failed entries from report...", flush=True)
            
            with open(args.retry_report, 'r') as f:
                report = json.load(f)
            
            # Find entries with Error status
            failed_entries = [entry for entry in report if entry.get('status') == 'Error']
            
            if not failed_entries:
                print("No failed entries found in report.")
                json_output("complete", {"stats": {"success": 0, "errors": 0, "duplicates": 0}})
                sys.exit(0)
            
            print(f"Found {len(failed_entries)} failed entries. Retrying...")
            
            # Re-process only failed entries
            stats = processor.retry_failed_entries(
                failed_entries=failed_entries,
                output_root=args.output,
                progress_callback=progress_callback
            )
            
            json_output("complete", {"stats": stats})
            print(f"Retry complete!")
            sys.exit(0)
            
        except Exception as e:
            print(f"Error during retry: {e}", file=sys.stderr)
            json_output("error", {"message": str(e)})
            sys.exit(1)
    
    if not args.zip:
        parser.error("--zip is required")
    
    if not args.output:
        parser.error("--output is required")
    
    try:
        print(f"Starting processing...", flush=True)
        
        stats = processor.process_from_zip(
            zip_path=args.zip,
            output_root=args.output,
            limit=args.limit,
            progress_callback=progress_callback,
            pause_batches=args.pause_batches,
            trust_manifest=args.trust_manifest
        )
        
        # Output final stats
        json_output("complete", {"stats": stats})
        
        print(f"Processing complete!", flush=True)
        sys.exit(0)
        
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        json_output("error", {"message": str(e)})
        sys.exit(1)

if __name__ == "__main__":
    main()
