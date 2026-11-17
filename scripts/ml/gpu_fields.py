import torch
def simulate(cells,weather,hazards,steps=60):
    device=cells.device;b=cells.shape[0]
    rain=weather[:,0,None,None];wind=weather[:,1,None,None];direction=weather[:,2,None,None]
    x=(torch.arange(28,device=device,dtype=torch.float32)+.5)[None,None,:]*80
    y=(torch.arange(20,device=device,dtype=torch.float32)+.5)[None,:,None]*80
    for step in range(steps):
        prev=cells
        elevation,fuel,water,fire,smoke,gas,damage=[prev[:,:,:,i] for i in range(7)]
        water_in=torch.zeros_like(water);ignition=torch.zeros_like(water);smoke_in=torch.zeros_like(water);gas_in=torch.zeros_like(water)
        for dx,dy in ((-1,0),(1,0),(0,-1),(0,1)):
            other=torch.roll(prev,shifts=(-dy,-dx),dims=(1,2))
            mask=torch.ones((1,20,28),dtype=torch.float32,device=device)
            if dx==-1:mask[:,:,0]=0
            if dx==1:mask[:,:,-1]=0
            if dy==-1:mask[:,0,:]=0
            if dy==1:mask[:,-1,:]=0
            upstream=torch.clamp(.25-(dx*torch.cos(direction)+dy*torch.sin(direction))*wind*.35,0,.7)
            water_in+=torch.clamp(other[:,:,:,2]+(other[:,:,:,0]-elevation)*.5-water,min=0)*.035*mask
            ignition+=other[:,:,:,3]*upstream*.025*mask
            smoke_in+=other[:,:,:,4]*upstream*.02*mask
            gas_in+=other[:,:,:,5]*upstream*.018*mask
        water=torch.clamp(water+2*(water_in-water*.013+rain*.0015),0,3)
        fire=torch.clamp(fire+2*(ignition*fuel-fire*(.006+rain*.028+water*.05)),0,1)
        smoke=torch.clamp(smoke+2*(smoke_in+fire*.018-smoke*.018),0,1)
        gas=torch.clamp(gas+2*(gas_in-gas*.018),0,1)
        for j in range(hazards.shape[1]):
            h=hazards[:,j];kind=h[:,0,None,None];hx=h[:,1,None,None];hy=h[:,2,None,None];radius=h[:,3,None,None];intensity=h[:,4,None,None]
            reach=torch.where(kind==6,radius*(1+wind*1.5),radius)
            distance=torch.sqrt((x-hx)**2+(y-hy)**2)
            influence=torch.clamp(1-distance/reach,0,1)*intensity
            downwind=torch.clamp(.6+((x-hx)*torch.cos(direction)+(y-hy)*torch.sin(direction))/torch.clamp(reach,min=80)*.8,0,1)
            water=torch.clamp(water+2*influence*(1-elevation*.6)*.013*(kind==0)+2*influence*.0025*(kind==5),0,3)
            fire=torch.clamp(fire+2*influence*fuel*.022*(kind==1),0,1)
            gas=torch.clamp(gas+2*influence*downwind*.02*(kind==6),0,1)
            age=h[:,5,None,None]+(step+1)*2
            damage=torch.clamp(damage+influence*2*torch.where((kind==2)&(age>24),.0005,.01)*((kind==2)|(kind==3)),0,1)
        fuel=torch.clamp(fuel-fire*2*.0015,0,1)
        damage=torch.clamp(damage+2*fire*.002,0,1)
        cells=torch.stack([elevation,fuel,water,fire,smoke,gas,damage],dim=-1)
    return cells
