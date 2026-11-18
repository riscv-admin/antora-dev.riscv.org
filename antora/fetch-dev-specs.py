#!/usr/bin/env python3
"""
Fetch development specification metadata from GitHub CSV and update development-specs.yml.

This script pulls development spec data from the adm-spec-dashboard CSV hosted on GitHub
and writes it to development-specs.yml in the format expected by the Antora 
development_specs_cards_generator.js extension.

The CSV is generated from JIRA data and published to GitHub at:
https://github.com/riscv/adm-spec-dashboard/blob/main/web-ui/public/latest.csv

Usage:
    python3 fetch-dev-specs.py [--output development-specs.yml] [--csv-url URL]
    
Environment Variables:
    GITHUB_TOKEN: GitHub API token (optional, for higher rate limits)
"""

import os
import sys
import yaml
import csv
import argparse
import requests
from datetime import datetime
from pathlib import Path
from io import StringIO

# Configuration
DEFAULT_OUTPUT = "development-specs.yml"
DEFAULT_CSV_URL = "https://raw.githubusercontent.com/riscv/adm-spec-dashboard/main/web-ui/public/latest.csv"

# Status mapping for development specs
STATUS_MAPPING = {
    "in design": "draft",
    "in review": "review",
    "freeze": "freeze",
    "stabilization": "stabilization",
    "ratification-ready": "ratification-ready",
}

# Only include specs with these statuses
ALLOWED_STATUSES = {
    "specification in freeze",
    "specification in ratification-ready",
    "specification under stabilization",
}

# Cache for GitHub release PDFs
_release_pdf_cache = {}


def fetch_csv_from_github(csv_url):
    """Fetch the latest.csv file from GitHub."""
    print(f"Fetching CSV from {csv_url}...")
    
    try:
        response = requests.get(csv_url, timeout=30)
        response.raise_for_status()
        return response.text
    except Exception as e:
        print(f"✗ Failed to fetch CSV: {e}")
        return None


def fetch_dev_specs_from_csv(csv_content):
    """
    Parse CSV content and convert to development-specs format.
    
    Expected CSV columns:
    - Jira URL
    - Summary
    - Status
    - BoD Report
    - ARC Review Status
    - Fast Track
    - Updated
    - ISA or NON-ISA?
    - GitHub
    - Baseline Ratification Quarter
    - Target Ratification Quarter
    - Ratification Progress
    - Previous Ratification Progress
    - Latest Release PDF
    
    Returns a list of spec dictionaries with fields:
        - title
        - status
        - group (ISA or Non-ISA)
        - html-url
        - pdf-url
        - details-url
        - fast-tracked (optional)
    """
    specs = []
    
    if not csv_content:
        print("✗ No CSV content to parse")
        return specs
    
    try:
        # Parse CSV
        reader = csv.DictReader(StringIO(csv_content), quotechar="'")
        rows = list(reader)
        print(f"✓ Parsed {len(rows)} specs from CSV")
        
        for row in rows:
            if not row:
                continue
            
            # Extract fields from CSV
            title = (row.get('Summary') or '').strip()
            status = (row.get('Status') or '').strip().lower()
            isa_or_non_isa = (row.get('ISA or NON-ISA?') or '').strip()
            github_url = (row.get('GitHub') or '').strip()
            jira_url = (row.get('Jira URL') or '').strip()
            pdf_url = (row.get('Latest Release PDF') or '').strip()
            fast_track = (row.get('Fast Track') or '').strip().lower()
            
            # Skip if missing critical fields
            if not title or not jira_url:
                continue
            
            # Map status to development-specs status
            mapped_status = STATUS_MAPPING.get(status, status)
            
            # Filter by allowed statuses
            if mapped_status not in ALLOWED_STATUSES:
                continue
            
            # Determine group
            group = "ISA" if "isa" in isa_or_non_isa.lower() else "Non-ISA"
            
            # Use GitHub URL as html-url if available, otherwise use Jira URL
            html_url = github_url if github_url and "github.com" in github_url else jira_url
            
            spec = {
                'title': title,
                'status': mapped_status,
                'group': group,
                'html-url': html_url,
                'details-url': jira_url,
            }
            
            if pdf_url and pdf_url != '':
                spec['pdf-url'] = pdf_url
            
            if fast_track == 'yes':
                spec['fast-tracked'] = True
            
            specs.append(spec)
            print(f"  ✓ {title} ({group}, {mapped_status})")
    
    except Exception as e:
        print(f"✗ Error parsing CSV: {e}")
        return []
    
    return specs


def validate_spec(spec):
    """Validate that a spec has all required fields."""
    required = ['title', 'status', 'group', 'html-url', 'details-url']
    missing = [field for field in required if field not in spec or not spec[field]]
    
    if missing:
        return False, f"Missing fields: {', '.join(missing)}"
    
    if spec.get('group', '').lower() not in ['isa', 'non-isa']:
        return False, f"Invalid group: {spec.get('group')} (must be 'ISA' or 'Non-ISA')"
    
    return True, None


def write_dev_specs_yml(specs, output_file):
    """Write development specs to development-specs.yml."""
    # Validate all specs
    valid_specs = []
    for spec in specs:
        is_valid, error = validate_spec(spec)
        if is_valid:
            valid_specs.append(spec)
        else:
            print(f"⚠ Skipping spec '{spec.get('title', 'Unknown')}': {error}")
    
    if not valid_specs:
        print("✗ No valid specs to write!")
        return False
    
    # Create output structure
    output = {
        'development-specs': valid_specs
    }
    
    # Write YAML with nice formatting
    try:
        with open(output_file, 'w') as f:
            yaml.dump(
                output,
                f,
                default_flow_style=False,
                sort_keys=False,
                allow_unicode=True,
                width=1000
            )
        print(f"✓ Wrote {len(valid_specs)} specs to {output_file}")
        return True
    except Exception as e:
        print(f"✗ Error writing to {output_file}: {e}")
        return False


def main():
    parser = argparse.ArgumentParser(
        description='Fetch development specifications from GitHub CSV and update development-specs.yml'
    )
    parser.add_argument(
        '--output',
        '-o',
        default=DEFAULT_OUTPUT,
        help=f'Output YAML file. Default: {DEFAULT_OUTPUT}'
    )
    parser.add_argument(
        '--csv-url',
        default=DEFAULT_CSV_URL,
        help=f'URL to CSV file. Default: {DEFAULT_CSV_URL}'
    )
    
    args = parser.parse_args()
    
    # Fetch CSV
    csv_content = fetch_csv_from_github(args.csv_url)
    
    if not csv_content:
        print("✗ Failed to fetch CSV.")
        sys.exit(1)
    
    # Parse specs from CSV
    specs = fetch_dev_specs_from_csv(csv_content)
    
    if not specs:
        print("✗ Failed to parse development specs.")
        sys.exit(1)
    
    # Write output
    output_path = Path(args.output)
    if not write_dev_specs_yml(specs, str(output_path)):
        sys.exit(1)
    
    print(f"\n✓ Successfully updated {output_path}")
    print(f"  Specs: {len(specs)}")
    print(f"  Last updated: {datetime.now().isoformat()}")


if __name__ == '__main__':
    main()
