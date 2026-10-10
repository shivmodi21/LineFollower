import numpy as np
import matplotlib.pyplot as plt
from scipy.integrate import odeint
#import ipywidgets as wg
 
n = 1001
tf = 1000.0
 
Kp = 0.9
tau_p = 175.0
theta_p = 15.0
 
def process(y,t,u):
    dydt = (1.0/tau_p) * (-(y - 23.0) + Kp * u)
    return dydt
 
def pidPlot(Kc,tauI,tauD):
    # initializing setpoints and PID parameters
    t = np.linspace(0,tf,n)
    P = np.zeros(n)
    I = np.zeros(n)
    D = np.zeros(n)
    e = np.zeros(n)
    OP = np.zeros(n)
    PV = np.ones(n)*23.0
    SP = np.ones(n)*23.0
    SP[10:300] = 50.0
    SP[300:600] = 40.0
    SP[600:1001] = 60.0
    y0 = 23.0
    iae = 0.0
 
    # looping through all time steps
    for i in range(1, n):
        ts = [t[i - 1], t[i]]
        y = odeint(process, y0, ts, args=(OP[max(0, i - int(theta_p))], ))
        y0 = y[1]
        iae += np.abs(SP[i] - y0[0])
        # calculate new OP with PID
        PV[i] = y[1]
        e[i] = SP[i] - PV[i]
        dt = t[i] - t[i - 1]
        P[i] = Kc * e[i]
        I[i] = I[i - 1] + (Kc/tauI) * e[i] * dt
        D[i] = -Kc * tauD * (PV[i] - PV[i - 1])/dt
        OP[i] = P[i] + I[i] + D[i]
        if OP[i] >= 100:
            OP[i] = 100.0
            I[i] = I[i-1]
        if OP[i] <= 0:
            OP[i] = 0.0
            I[i] = I[i - 1]
 
    # plot PID response
    plt.figure(1, figsize=(20, 7))
    plt.subplot(2, 2, 1)
    plt.plot(t, SP, 'k-', linewidth=2, label='Setpoint (SP)')
    plt.plot(t, PV, 'r:', linewidth=2, label='F(x)')
    plt.ylabel('F(x)')
    plt.text(100, 30, 'Integral Abs Error: ' + str(np.round(iae, 2)))
    plt.legend(loc='best')
 
#Kc_slide = wg.FloatSlider(value=5.0, min=0.0, max=50.0, step=1.0)
#tauI_slide = wg.FloatSlider(value=5.0, min=5.0, max=180.0, step=5.0)
#tauD_slide = wg.FloatSlider(value=0.0, min=0.0, max=20.0, step=1.0)
#wg.interact(pidPlot, Kc=Kc_slide, tauI=tauI_slide, tauD=tauD_slide)