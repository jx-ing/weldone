"""Analytical outline for the stepped-deck, 12-rib subassembly family.

This profile is used only after confirming the deck and rib stations in the
observed cloud. Rib, stiffener and flange outlines are recovered from that cloud.
Other subassemblies go through the general paired-plane fitter.
"""
import numpy as np
from math import sqrt
from itertools import pairwise
from scipy.optimize import brentq
from OCP.BRepAlgoAPI import BRepAlgoAPI_Common
from geometry import Outline, cut, cylinder, extrude_xy, polygon, prism, sampled_prism, transform_parts

def build_known_profile(points, normals, offset, frame):
    x,y,z=points.T
    parts=[]
    def add(label, shape):
        parts.append((label,shape))

    FORWARD=1955.5
    AFT=6741.315

    def circle_x(yy,cx,cy,r):
        return cx+sqrt(r*r-(yy-cy)**2)

    def deck_left(yy):
        if yy<FORWARD:
            return circle_x(yy,-3250,FORWARD,3250)
        if yy>AFT:
            return circle_x(yy,-5000,AFT,5000)
        return 0.0

    def deck_left_path(o,high,low):
        cuts=[high]+[k for k in (AFT,FORWARD) if low<k<high]+[low]
        for a,b in pairwise(cuts):
            mid=(a+b)/2
            end=(deck_left(b),b)
            if mid<FORWARD or mid>AFT:
                o.arc((deck_left(mid),mid),end)
            else:
                o.line(end)

    NOTCHES=[
        (427,552,581,48),(1277,1402,1431,48),
        (2973,3102,3129,10),(4677,4802,4831,48),
        (5527,5652,5681,48),(6377,6502,6531,48),
        (7227,7352,7381,10),(8073,8202,8229,10),(8923,9052,9079,10),
    ]
    HOLES=[(2675,50),(3452,40),(7786,40),(8460,50),(9225,50)]
    SLANT=np.array([-.47447,.88027]); SLANT/=np.linalg.norm(SLANT)
    SLANT_D=8306.50
    YEND=10060.0
    END_LEFT=brentq(lambda yy: np.dot(SLANT,[deck_left(yy),yy])-SLANT_D,9080,9145)

    def deck_notch(o,a,b,c,rejoin):
        o.line((1800,a))
        o.line((1451,a))
        o.round((1451,a+50),(1401,a+50))
        o.line((1401,c))
        o.arc((1451,c+50),(1501,c))
        o.line((1501,b))
        if rejoin==48:
            o.line((1800-sqrt(50**2-2**2),b))
            o.round((1800,b-2),(1800,b+48))
        else:
            o.line((1790,b))
            o.round((1790,b+10),(1800,b+10))

    def large_notch(o):
        o.line((1800,2094))
        o.line((1436,2094))
        o.round((1436,2194),(1336,2194))
        o.line((1336,2294))
        o.round((1436,2294),(1436,2394))
        o.line((1800,2394))

    def deck(lo, hi, thickness):
        o=Outline((deck_left(lo),lo))
        if lo==0:
            o.line((1765,0))
            o.line((1765,15))
            o.round((1800,15),(1800,50))
        elif lo==3790:
            o.line((1336,lo))
            o.line((1336,3996))
            o.round((1436,3996),(1436,4096))
            o.line((1800,4096))
        else:
            o.line((1800,lo))
        for a,b,c,r in NOTCHES:
            if lo<a<hi:
                if a==2973:
                    large_notch(o)
                deck_notch(o,a,b,c,r)
        if hi==YEND:
            o.line((1800,9646))
            o.line((1434,9646))
            o.round((1434,9746),(1334,9746))
            cy=YEND-150
            cx=(SLANT_D-150-SLANT[1]*cy)/SLANT[0]
            c=np.array([cx,cy])
            tangent=c+150*SLANT
            o.line((1334,YEND))
            o.line((cx,YEND))
            o.round(c,tangent)
            o.line((deck_left(END_LEFT),END_LEFT))
            hi=END_LEFT
        else:
            o.line((1800,hi))
            o.line((deck_left(hi),hi))
        deck_left_path(o,hi,lo)
        shape=extrude_xy(o,-thickness,0)
        for yy,r in HOLES:
            if lo<yy<(YEND if lo==6720 else hi):
                shape=cut(shape,cylinder(1700,yy,-thickness-1,1,r))
        if lo==6720:
            wedge=polygon([(6718,-15),(6736,-15),(6736,-14),(6720,-10),(6718,-9.5)])
            shape=cut(shape,prism(wedge,lambda q:[-50,*q],[1900,0,0]))
        return shape

    for i,(a,b,t) in enumerate([(0,975,11),(975,3790,13),(3790,6720,10),(6720,YEND,14)],1):
        add(f'Deck plate {i:02d}',deck(a,b,t))

    def web_forward():
        outer_y=12.02
        xo=lambda yy: circle_x(yy,-3250,FORWARD,3230)
        o=Outline((deck_left(0),0))
        o.line((xo(outer_y),outer_y))
        mid=(outer_y+FORWARD)/2
        o.arc((xo(mid),mid),(-20,FORWARD))
        o.line((-20,6720))
        o.line((0,6720))
        o.line((0,FORWARD))
        mid=FORWARD/2
        o.arc((deck_left(mid),mid),(deck_left(0),0))
        return extrude_xy(o,-129,121)

    add('Forward curved longitudinal web',web_forward())
    def web_aft():
        xo=lambda yy: circle_x(yy,-5000,AFT,4974)
        y_out=brentq(lambda yy: np.dot(SLANT,[xo(yy),yy])-SLANT_D,9060,9130)
        st=6752.2
        o=Outline((0,6720))
        o.line((-20,6720))
        o.line((xo(st),st))
        mid=(st+y_out)/2
        o.arc((xo(mid),mid),(xo(y_out),y_out))
        o.line((deck_left(END_LEFT),END_LEFT))
        mid=(END_LEFT+AFT)/2
        o.arc((deck_left(mid),mid),(0,AFT))
        o.line((0,6720))
        body=extrude_xy(o,-154,146)
        trim=polygon([(6720,-129),(6820,-154),(9200,-154),(9200,146),(6820,146),(6720,121)])
        clip=prism(trim,lambda q:[-800,*q],[900,0,0])
        result=BRepAlgoAPI_Common(body,clip)
        assert result.IsDone()
        return result.Shape()

    add('Aft curved longitudinal web',web_aft())
    for j,(yy,z0,z1,plate_bottom) in enumerate([(1800,-81.5,68.5,-14),(6050,-80,70,-11)],1):
        sleeve=cut(cylinder(1200,yy,z0,z1,155),cylinder(1200,yy,z0-1,z1+1,140))
        for half,xmin,xmax in [('A',1000,1200),('B',1200,1400)]:
            clip=extrude_xy(polygon([(xmin,yy-160),(xmax,yy-160),(xmax,yy+160),(xmin,yy+160)]),z0-1,z1+1)
            split=BRepAlgoAPI_Common(sleeve,clip)
            assert split.IsDone()
            add(f'Pipe sleeve {j:02d} {half}',split.Shape())
        add(f'Circular insert {j:02d}',cylinder(1200,yy,plate_bottom,1,157))

    RIBS=[
        (538,550,-294,120),(1388,1400,-23,120),
        (2238,2250,0,650),(3084,3100,0,400),
        (3938,3950,0,120),(4788,4800,0,120),
        (5638,5650,0,650),(6488,6500,0,120),
        (7338,7350,-4,120),(8188,8200,-213.862,850),
        (9034,9050,-556.622,400),(9784,9800,674.762,150),
    ]
    for i,(a,b,xlo,zhi) in enumerate(RIBS,1):
        mask=(y>=a-.001)&(y<=b+.001)&(z>=0)&(z<=zhi+.001)&(x>=xlo-.002)&(x<=1436.001)
        side_or_broad=(abs(normals[:,1])>.99999)&((abs(y-a)<.001)|(abs(y-b)<.001))
        side_or_broad|=(abs(normals[:,1])<.01)&(y>a+.001)&(y<b-.001)
        mask &= side_or_broad
        if i in (1,2,9):
            left_edge=deck_left((a+b)/2)
            mask &= (x>left_edge+6)|side_or_broad&(abs(normals[:,1])>.99999)
        sr=[(1,0,.3),(0,1436,.3),(1,zhi,.65)]
        if i in (10,11,12):
            sr.append((0,xlo,.25))
        add(f'Transverse rib {i:02d}',sampled_prism(points,f'Transverse rib {i:02d}',mask,[0,0,1],[1,0,0],-b,-a,24,.53,sr))

    STIFFENERS=[
        ([.89328,-.44950,0],290.143,302.143,35,510,100),
        ([.97064,-.24052,0],451.62,463.62,580,1360,100),
        ([.99901,-.04443,0],749.19,761.19,1420,2213,100),
        ([.98418,.17718,0],2096.576,2107.576,7375,8163,120),
        ([.94642,.32295,0],3266.77,3277.77,8225,9005,120),
        ([.88795,.45995,0],4484.68,4495.68,9075,9758,120),
    ]
    for i,(sample,a,b,ya,yb,zt) in enumerate(STIFFENERS,1):
        v=np.asarray(sample)
        direction=(normals[np.linalg.norm(normals-v,axis=1)<2e-5].astype('float64')).mean(0)
        direction[2]=0
        direction/=np.linalg.norm(direction)
        tang=np.cross([0,0,1],direction)
        s=points@direction
        yn=(y>ya)&(y<yb)&(z>=0)&(z<=zt)
        orth=np.abs(normals@direction)
        face=yn&(orth>.999999)&((abs(s-a)<.07)|(abs(s-b)<.07))
        a=np.median(s[face&(abs(s-a)<.07)])
        b=np.median(s[face&(abs(s-b)<.07)])
        include=face|(yn&(s>a+.001)&(s<b-.001)&(orth<.01))
        add(f'Longitudinal stiffener {i:02d}',sampled_prism(points,f'Longitudinal stiffener {i:02d}',include,[0,0,1],tang,a,b,25,.6,[(1,0,.3),(1,zt,.3)]))

    CAPS=[
        ([-5/13,0,12/13],-117.77,-105.77,2118,2238),
        ([-5/13,0,12/13],-117.77,-105.77,5518,5638),
        ([-.42289,0,.90618],.06,12.06,8038,8188),
    ]
    for i,(sample,a,b,y0,y1) in enumerate(CAPS,1):
        v=np.asarray(sample)
        direction=normals[np.linalg.norm(normals-v,axis=1)<1e-4].astype('float64').mean(0)
        direction[1]=0
        direction/=np.linalg.norm(direction)
        tang=np.cross([0,1,0],direction)
        s=points@direction
        yn=(y>=y0-.001)&(y<=y1+.001)&(z>40)
        orth=np.abs(normals@direction)
        fa=yn&(orth>.999999)&(abs(s-a)<.22)
        fb=yn&(orth>.999999)&(abs(s-b)<.22)
        lo=np.median(s[fa]);hi=np.median(s[fb])
        include=fa|fb|(yn&(s>lo+.001)&(s<hi-.001)&(orth<.01))
        add(f'Inclined rib flange {i:02d}',sampled_prism(points,f'Inclined rib flange {i:02d}',include,[0,1,0],tang,lo,hi,23,.6,[(1,y0,.4),(1,y1,.4)]))
    return transform_parts(parts, offset, frame)
