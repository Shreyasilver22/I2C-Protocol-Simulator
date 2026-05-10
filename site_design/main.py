import uvicorn
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import json
import asyncio

app = FastAPI()

# Serve the frontend from the same backend
app.mount("/", StaticFiles(directory=".", html=True), name="static")

# Allow frontend to connect
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- I2C SIMULATION ENGINE ---
class I2CBus:

    def tick(self):
        """Records the state and triggers physical edge-detection in slaves"""
        sda = self.get_sda()
        scl = self.get_scl()
        self.history["sda"].append(sda)
        self.history["scl"].append(scl)
        
        # Tell every connected device what the wires currently look like
        for dev in self.devices:
            if hasattr(dev, 'on_tick'):
                dev.on_tick(sda, scl)
    
    def __init__(self):
        self.devices = []
        self.history = {"scl": [], "sda": []}

    def connect(self, device):
        self.devices.append(device)

    def get_sda(self):
        for dev in self.devices:
            if dev.sda_intent == 0: return 0
        return 1

    def get_scl(self):
        for dev in self.devices:
            if dev.scl_intent == 0: return 0
        return 1

    def tick(self):
        """Records the state of the bus at this exact moment"""
        self.history["sda"].append(self.get_sda())
        self.history["scl"].append(self.get_scl())

    def reset_history(self):
        self.history = {"scl": [], "sda": []}

class Device:
    def __init__(self, name, address=None):
        self.name = name
        self.address = address
        self.sda_intent = 1
        self.scl_intent = 1

class Master(Device):
    def __init__(self, name, bus):
        super().__init__(name)
        self.bus = bus

    def start(self):
        self.sda_intent = 0
        self.scl_intent = 1
        self.bus.tick()
        return True

    def stop(self):
        self.sda_intent = 1
        self.scl_intent = 1
        self.bus.tick()

    def send_bit(self, bit):
        self.sda_intent = bit
        self.scl_intent = 1
        self.bus.tick() # Clock High
        
        self.scl_intent = 0
        self.bus.tick() # Clock Low

    def send_byte(self, byte):
        for i in range(8):
            bit = (byte >> (7 - i)) & 1
            self.send_bit(bit)

    def check_ack(self):
        self.sda_intent = 1
        self.scl_intent = 1
        self.bus.tick()
        # Slave should pull low here if it exists
        self.scl_intent = 0
        self.bus.tick()

    def transmit(self, address, data):
        self.bus.reset_history()
        self.bus.tick() # Idle state
        
        self.start()
        self.send_byte(address << 1)
        self.check_ack()
        self.send_byte(data)
        self.check_ack()
        self.stop()
        
        self.bus.tick() # Return to idle

class ActiveSlave(Device):
    def __init__(self, name, address, bus):
        super().__init__(name, address)
        self.bus = bus
        self.state = "IDLE"
        self.bit_count = 0
        self.current_byte = 0
        self.last_scl = 1
        self.last_sda = 1

    def on_tick(self, sda, scl):
        # 1. Detect START: SDA goes low while SCL is high
        if scl == 1 and self.last_sda == 1 and sda == 0:
            self.state = "READING"
            self.bit_count = 0
            self.current_byte = 0
            self.sda_intent = 1

        # 2. Detect STOP: SDA goes high while SCL is high
        elif scl == 1 and self.last_sda == 0 and sda == 1:
            self.state = "IDLE"
            self.sda_intent = 1

        # 3. Rising Edge of Clock: Read the data line
        elif self.last_scl == 0 and scl == 1:
            if self.state == "READING":
                if self.bit_count < 8:
                    # Shift the bit into our byte
                    self.current_byte = (self.current_byte << 1) | sda
                    self.bit_count += 1

        # 4. Falling Edge of Clock: Prepare to ACK or Release
        elif self.last_scl == 1 and scl == 0:
            if self.bit_count == 8:
                # We just finished reading 8 bits. Was it for us?
                # Shift right by 1 to ignore the R/W bit for now
                addr_received = self.current_byte >> 1 
                
                if addr_received == self.address:
                    self.sda_intent = 0  # We are pulling LOW for ACK!
                else:
                    self.sda_intent = 1  # Not us, ignore (NACK)
                
                # Reset for the next byte
                self.bit_count = 0
                self.current_byte = 0
            else:
                self.sda_intent = 1  # Let go of the bus while reading

        self.last_scl = scl
        self.last_sda = sda

# Remember to update your WebSocket endpoint to use ActiveSlave:
# slave1 = ActiveSlave("EEPROM", 0x50, bus)
# slave2 = ActiveSlave("TempSensor", 0x27, bus)

# --- API ENDPOINTS ---
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    
    # Setup Bus and Devices
    bus = I2CBus()
    master = Master("M1", bus)
    
    # UPDATED: We are now using the ActiveSlave state machines!
    slave1 = ActiveSlave("EEPROM", 0x50, bus)
    slave2 = ActiveSlave("TempSensor", 0x27, bus)
    
    bus.connect(master)
    bus.connect(slave1)
    bus.connect(slave2)
    
    try:
        while True:
            # Wait for command from frontend
            data = await websocket.receive_text()
            request = json.loads(data)
            
            addr = int(request.get("address", "0x00"), 16)
            payload = int(request.get("data", "0x00"), 16)
            
            # Run simulation
            master.transmit(addr, payload)
            
            # Send waveform history back to UI
            await websocket.send_text(json.dumps({
                "status": "success",
                "waveform": bus.history
            }))
    except Exception as e:
        print(f"Connection closed: {e}")


if __name__ == "__main__":
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
