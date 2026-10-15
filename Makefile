build:
	uv run -q build.py

serve:
	uv run -q build.py --serve

import:
	uv run -q tools/import_mirror.py

.PHONY: build serve import
