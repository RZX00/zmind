#!/bin/bash
export VIRTUAL_ENV=$(pwd)/.venv_new
source .venv_new/bin/activate
export PYTHONPATH=$(pwd):$PYTHONPATH
python api.py

