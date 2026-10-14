"""CLI: python -m studio.cli proposal.yaml out.pptx"""
import sys

import yaml

from .models import Proposal
from .render import render


def main(argv=None) -> int:
    argv = argv or sys.argv[1:]
    if len(argv) != 2:
        print("usage: python -m studio.cli <proposal.yaml> <out.pptx>")
        return 2
    with open(argv[0]) as fh:
        proposal = Proposal.model_validate(yaml.safe_load(fh))
    print(render(proposal, argv[1]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
