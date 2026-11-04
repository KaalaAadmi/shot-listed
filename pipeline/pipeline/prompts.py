"""Loads ../prompts/*.md the way web/scripts/build-prompts.mts does: same files, same {{variables}}."""

import json
import re
from pathlib import Path

PROMPTS_DIR = Path(__file__).resolve().parents[2] / "prompts"


def _block(md: str, heading: str, prompt_id: str) -> str:
    m = re.search(rf"## {heading}\n\n```text\n(.*?)\n```", md, re.S)
    if not m:
        raise ValueError(f'{prompt_id}: "## {heading}" with a text block is missing')
    return m.group(1)


def render(prompt_id: str, variables: dict[str, str], directory: Path = PROMPTS_DIR) -> dict:
    """Returns system, user, schema, temperature and a stamp like "library-tagger@1"."""
    md = (directory / f"{prompt_id}.md").read_text()
    front_matter = re.match(r"---\n(.*?)\n---", md, re.S)
    if not front_matter:
        raise ValueError(f"{prompt_id}: front matter is missing")
    fm = {k.strip(): v.strip() for k, _, v in (line.partition(":") for line in front_matter.group(1).split("\n"))}
    schema = json.loads((directory / fm["output"]).read_text())
    schema.pop("$schema", None)  # the models take the schema itself, not its metadata
    schema.pop("title", None)

    def fill(text: str) -> str:
        return re.sub(r"\{\{(\w+)\}\}", lambda m: str(variables.get(m.group(1), "")), text)

    return {
        "system": fill(_block(md, "System", prompt_id)),
        "user": fill(_block(md, "User", prompt_id)),
        "schema": schema,
        "temperature": float(fm["temperature"]),
        "prompt": f"{prompt_id}@{fm['version']}",
    }
