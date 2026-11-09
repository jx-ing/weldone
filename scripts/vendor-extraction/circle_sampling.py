"""Sample original analytic CAD circles without losing short-arc curvature."""
from __future__ import annotations

import math
import numpy as np


def sample_circle_points(curve, first, last, deflection_mm=.2, max_angle_deg=5):
    """Return on-circle points, original endpoints included, with both bounds.

    A chord-error bound alone permits a short arc to export as two endpoints.
    Require at least two chords and limit every angular step to five degrees.
    The circle radius and source parameters are never fitted or modified.
    """
    radius=float(curve.Circle().Radius())
    if (not all(math.isfinite(value) for value in (radius,first,last,deflection_mm,max_angle_deg))
            or radius<=0 or deflection_mm<=0 or max_angle_deg<=0):
        raise ValueError('Circle sampling requires finite parameters and positive radius/bounds')
    # Equivalent to 2*acos(1-deflection/radius), without cancellation for
    # a large radius and a small chord-error bound.
    deflection_angle=4*math.asin(math.sqrt(min(1.,deflection_mm/(2*radius))))
    step=min(math.radians(max_angle_deg),deflection_angle)
    divisions=max(2,int(math.ceil(abs(last-first)/step)))
    points=[]
    for parameter in np.linspace(first,last,divisions+1):
        point=curve.Value(float(parameter))
        points.append(np.array([point.X(),point.Y(),point.Z()],dtype=float))
    return points
