from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parent/'vendor-extraction'))
from analyze_step_model import analyze
root=Path(__file__).resolve().parents[1]
analyze(root/'public/models/111.step',root/'public/models/111-rules',model_id='111-original-platform',workpiece_type='small')
