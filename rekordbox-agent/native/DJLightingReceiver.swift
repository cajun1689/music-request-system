import Foundation
import AppKit
import CoreMIDI
import Darwin

// No mixer/deck controls or hardware MIDI output. JSON lines go only to the parent.
let args = Array(CommandLine.arguments.dropFirst())
func emit(_ object: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: object) else { return }
    do { try FileHandle.standardOutput.write(contentsOf: data + Data([10])) } catch { exit(0) }
}
struct Estimator {
    var times: [Double] = []
    mutating func tick(_ now: Double) -> Double? {
        if let last = times.last, now <= last || now - last > 0.5 { times.removeAll() }
        times.append(now); if times.count > 97 { times.removeFirst(times.count - 97) }
        guard times.count >= 49, let first = times.first, now > first else { return nil }
        let bpm = 60 * Double(times.count - 1) / (24 * (now - first))
        return bpm.isFinite && bpm >= 30 && bpm <= 300 ? bpm : nil
    }
}
if args == ["--self-test"] {
    for bpm in [60.0, 127.4, 225.0] {
        var e = Estimator(); var result: Double?
        for i in 0...100 { result = e.tick(Double(i) * 60 / bpm / 24) }
        precondition(abs(result! - bpm) < 0.0001)
        _ = e.tick(1000); precondition(e.times.count == 1)
    }
    emit(["type": "test", "passed": true]); exit(0)
}
let parent = getppid()
var captureInterface: String?
if args.count == 2 && args[0] == "--capture" { captureInterface = args[1] }
else if !args.isEmpty { emit(["type": "error", "message": "Invalid receiver arguments"]); exit(2) }
signal(SIGPIPE, SIG_IGN)
let queue = DispatchQueue(label: "DJBridgeLighting", qos: .userInteractive)
func now() -> Double { Double(DispatchTime.now().uptimeNanoseconds) / 1e9 }
var client = MIDIClientRef(), input = MIDIPortRef(), relay = MIDIEndpointRef()
var connected = Set<MIDIEndpointRef>()
func displayName(_ endpoint: MIDIEndpointRef) -> String {
    var value: Unmanaged<CFString>?
    guard MIDIObjectGetStringProperty(endpoint, kMIDIPropertyDisplayName, &value) == noErr else { return "" }
    return value?.takeRetainedValue() as String? ?? ""
}
func reconnect() {
    var current = Set<MIDIEndpointRef>()
    for i in 0..<MIDIGetNumberOfSources() {
        let source = MIDIGetSource(i)
        if displayName(source) == "DJM-A9" { current.insert(source) }
    }
    for source in connected.subtracting(current) { MIDIPortDisconnectSource(input, source) }
    connected.formIntersection(current)
    for source in current.subtracting(connected) {
        if MIDIPortConnectSource(input, source, nil) == noErr { connected.insert(source) }
    }
    emit(["type": "usb", "connected": !connected.isEmpty])
}
var estimator = Estimator(), lastReport = 0.0
let midiOK = MIDIClientCreateWithBlock("DJ Bridge Lighting" as CFString, &client, { _ in queue.async { reconnect() } }) == noErr
if midiOK {
    _ = MIDISourceCreate(client, "A9 Network Beat" as CFString, &relay)
    let result = MIDIInputPortCreateWithBlock(client, "A9 clock" as CFString, &input, { list, _ in
        var p = UnsafeRawPointer(list).advanced(by: MemoryLayout<MIDIPacketList>.offset(of: \.packet)!).assumingMemoryBound(to: MIDIPacket.self)
        var count = 0
        for _ in 0..<list.pointee.numPackets {
            let packet = p.pointee
            let ticks = withUnsafeBytes(of: packet.data) { Array($0.prefix(Int(packet.length)).filter { $0 == 0xf8 }) }
            count += ticks.count
            // Preserve the old Lightkey clock source, without sending MIDI to hardware.
            if !ticks.isEmpty && relay != 0 {
                var output = MIDIPacketList()
                withUnsafeMutablePointer(to: &output) { target in
                    let first = MIDIPacketListInit(target)
                    ticks.prefix(256).withUnsafeBufferPointer { bytes in
                        _ = MIDIPacketListAdd(target, MemoryLayout<MIDIPacketList>.size, first, packet.timeStamp, bytes.count, bytes.baseAddress!)
                        MIDIReceived(relay, target)
                    }
                }
            }
            p = UnsafePointer(MIDIPacketNext(p))
        }
        let received = now(), tickCount = count
        queue.async {
            guard tickCount == 1 else { if tickCount > 1 { estimator.times.removeAll() }; return }
            if let bpm = estimator.tick(received), received - lastReport >= 0.5 {
                lastReport = received; emit(["type": "tempo", "bpm": bpm])
            }
        }
    })
    if result == noErr { queue.async { reconnect() } }
    else { emit(["type": "error", "message": "A9 MIDI input is unavailable"]) }
} else { emit(["type": "error", "message": "CoreMIDI is unavailable"]) }
var capture: OpaquePointer?
var reader: DispatchSourceRead?
if let iface = captureInterface {
    var error = [CChar](repeating: 0, count: Int(PCAP_ERRBUF_SIZE))
    capture = pcap_open_live(iface, 512, 0, 10, &error)
    if let c = capture {
        var program = bpf_program()
        let filter = "udp dst port 50001 and udp[8:4] = 0x51737074 and (udp[18] = 3 or udp[18] = 40)"
        if pcap_datalink(c) == DLT_EN10MB && pcap_compile(c, &program, filter, 1, PCAP_NETMASK_UNKNOWN) == 0 {
            let set = pcap_setfilter(c, &program); pcap_freecode(&program)
            if set == 0 && pcap_setnonblock(c, 1, &error) == 0 {
                let fd = pcap_get_selectable_fd(c)
                if fd >= 0 {
                    reader = DispatchSource.makeReadSource(fileDescriptor: fd, queue: queue)
                    reader?.setEventHandler {
                        while true {
                            var header: UnsafeMutablePointer<pcap_pkthdr>?
                            var packet: UnsafePointer<UInt8>?
                            let result = pcap_next_ex(c, &header, &packet)
                            if result == 0 { break }
                            if result < 0 { emit(["type": "error", "message": "DJ network capture disconnected"]); exit(3) }
                            guard let h = header, let p = packet, h.pointee.caplen <= 512 else { continue }
                            let f = Array(UnsafeBufferPointer(start: p, count: Int(h.pointee.caplen)))
                            guard f.count >= 42, f[12] == 8, f[13] == 0, f[14] >> 4 == 4, f[23] == 17,
                                  f[20] & 0x3f == 0, f[21] == 0 else { continue }
                            let ihl = Int(f[14] & 15) * 4, u = 14 + ihl
                            guard ihl >= 20, f.count >= u + 8 else { continue }
                            let length = Int(f[u+4]) * 256 + Int(f[u+5])
                            guard length >= 8, f.count >= u + length else { continue }
                            let source = f[26..<30].map(String.init).joined(separator: ".")
                            emit(["type": "packet", "source": source, "payload": Data(f[(u+8)..<(u+length)]).base64EncodedString()])
                        }
                    }
                    reader?.resume(); emit(["type": "capture", "connected": true])
                }
            }
        }
        if reader == nil { pcap_close(c); capture = nil }
    }
    if reader == nil { emit(["type": "error", "message": "DJ beat port is busy and packet capture is unavailable. Check local network/capture permission or close the conflicting app."]) }
}
let life = DispatchSource.makeTimerSource(queue: queue)
life.schedule(deadline: .now() + 1, repeating: 1)
var lastSeratoCheck = 0.0
life.setEventHandler {
    if getppid() != parent || parent <= 1 { exit(0) }
    if now() - lastSeratoCheck >= 5 {
        lastSeratoCheck = now()
        let running = NSWorkspace.shared.runningApplications.contains { app in
            (app.bundleIdentifier ?? "").lowercased().hasPrefix("com.serato.")
        }
        emit(["type": "serato", "running": running])
    }
}
life.resume()
emit(["type": "ready"])
dispatchMain()
