#!/usr/bin/env python3
"""
CLI wrapper for DateBack
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
    elif isinstance(progress, dict):
        msg_type = progress.get("type")
        if msg_type:
            print(json.dumps(progress), flush=True)
        else:
            json_output("progress", progress)
    else:
        json_output("progress", {"percent": progress})

def main():
    parser = argparse.ArgumentParser(description='DateBack CLI')
    parser.add_argument('--zip', help='Path to mydata.zip file')
    parser.add_argument('--output', help='Output directory')
    parser.add_argument('--limit', type=int, help='Limit number of memories to process')
    parser.add_argument('--pause-batches', action='store_true', help='Pause between batches for cloud sync')
    parser.add_argument('--trust-manifest', action='store_true', help='Trust manifest for resume (skip filesystem checks)')
    parser.add_argument('--auto-upload', action='store_true', help='Enable automatic staging->upload->delete pipeline')
    parser.add_argument('--destination-dir', help='Destination directory for auto-upload')
    parser.add_argument('--cache-gb', type=float, default=5.0, help='Pause processing when staging cache reaches this size (GB)')
    parser.add_argument('--cache-low-gb', type=float, default=3.0, help='Resume processing when staging cache drops below this size (GB)')
    parser.add_argument('--upload-mode', choices=['copy', 'move'], default='copy', help='Upload mode for destination adapter')
    parser.add_argument('--staging-dir', help='Optional staging directory path')
    parser.add_argument('--max-upload-retries', type=int, default=20, help='Maximum upload retries per staged file before fatal exit')
    parser.add_argument('--retry-report', help='Path to detailed_report.json to retry failed entries')
    
    args = parser.parse_args()
    
    if args.auto_upload and not args.destination_dir:
        parser.error("--destination-dir is required with --auto-upload")

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
                progress_callback=progress_callback,
                auto_upload=args.auto_upload,
                destination_dir=args.destination_dir,
                cache_gb=args.cache_gb,
                cache_low_gb=args.cache_low_gb,
                upload_mode=args.upload_mode,
                staging_dir=args.staging_dir,
                max_upload_retries=args.max_upload_retries
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
            trust_manifest=args.trust_manifest,
            auto_upload=args.auto_upload,
            destination_dir=args.destination_dir,
            cache_gb=args.cache_gb,
            cache_low_gb=args.cache_low_gb,
            upload_mode=args.upload_mode,
            staging_dir=args.staging_dir,
            max_upload_retries=args.max_upload_retries
        )
        
        # Output final stats
        json_output("complete", {"stats": stats})
        
        print(f"Processing complete!", flush=True)
        sys.exit(0)
    except processor.RuntimeDiskFullError as e:
        json_output("error", {
            "errorType": "DISK_FULL",
            "message": str(e),
            "details": getattr(e, "details", {}) or {}
        })
        sys.exit(1)
    except BaseException as e:
        print(f"Error: {e}", file=sys.stderr)
        json_output("error", {"message": str(e)})
        sys.exit(1)

if __name__ == "__main__":
    main()
