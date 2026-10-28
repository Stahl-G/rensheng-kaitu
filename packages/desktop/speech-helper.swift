import Foundation
import Speech
import AVFoundation

// One user-initiated session. Commands are read from stdin; audio never leaves this process.
func emit(_ state: String, _ text: String = "") {
    let data = try! JSONSerialization.data(withJSONObject: ["state": state, "text": text])
    print(String(decoding: data, as: UTF8.self)); fflush(stdout)
}
let engine = AVAudioEngine()
var request: SFSpeechAudioBufferRecognitionRequest?
var task: SFSpeechRecognitionTask?
var terminal = false
var latest = ""
func finish(_ state: String, _ text: String = "") {
    guard !terminal else { return }
    terminal = true
    if engine.isRunning { engine.stop(); engine.inputNode.removeTap(onBus: 0) }
    request?.endAudio(); task?.cancel()
    emit(state, text)
    exit(0)
}
// Offline fixture mode never requests permission and never opens the microphone.
if CommandLine.arguments.count == 3 && CommandLine.arguments[1] == "--fixture" {
    guard SFSpeechRecognizer.authorizationStatus() == .authorized else { emit("denied"); exit(0) }
    guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US")), recognizer.isAvailable,
          recognizer.supportsOnDeviceRecognition else { emit("unavailable"); exit(0) }
    let fixture = SFSpeechURLRecognitionRequest(url: URL(fileURLWithPath: CommandLine.arguments[2]))
    fixture.requiresOnDeviceRecognition = true
    task = recognizer.recognitionTask(with: fixture) { result, error in
        if let result = result, result.isFinal { emit("done", result.bestTranscription.formattedString); exit(0) }
        if error != nil { emit("error"); exit(0) }
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + 20) { emit("timeout"); exit(0) }
    dispatchMain()
}
func begin() {
    let locale = Locale(identifier: CommandLine.arguments.dropFirst().first ?? "zh-CN")
    guard let recognizer = SFSpeechRecognizer(locale: locale), recognizer.isAvailable,
          recognizer.supportsOnDeviceRecognition else { finish("unavailable"); return }
    let r = SFSpeechAudioBufferRecognitionRequest()
    r.requiresOnDeviceRecognition = true
    r.shouldReportPartialResults = true
    request = r
    let node = engine.inputNode
    let format = node.outputFormat(forBus: 0)
    guard format.sampleRate > 0 && format.channelCount > 0 else { finish("unavailable"); return }
    node.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in r.append(buffer) }
    task = recognizer.recognitionTask(with: r) { result, error in
        DispatchQueue.main.async {
            if let result = result {
                latest = result.bestTranscription.formattedString
                if result.isFinal { finish("done", latest); return }
            }
            if error != nil { finish("error") }
        }
    }
    do { engine.prepare(); try engine.start(); emit("recording") }
    catch { finish("error") }
}
let requestedLocale = Locale(identifier: CommandLine.arguments.dropFirst().first ?? "zh-CN")
guard let requestedRecognizer = SFSpeechRecognizer(locale: requestedLocale), requestedRecognizer.isAvailable,
      requestedRecognizer.supportsOnDeviceRecognition else { emit("unavailable"); exit(0) }
SFSpeechRecognizer.requestAuthorization { status in
    DispatchQueue.main.async {
        guard status == .authorized else { finish("denied"); return }
        AVCaptureDevice.requestAccess(for: .audio) { allowed in
            DispatchQueue.main.async { if allowed { begin() } else { finish("denied") } }
        }
    }
}
let input = DispatchSource.makeReadSource(fileDescriptor: STDIN_FILENO, queue: .main)
input.setEventHandler {
    guard let line = readLine() else { finish("cancelled"); return }
    if line == "cancel" { finish("cancelled") }
    if line == "stop" {
        guard engine.isRunning else { finish("cancelled"); return }
        engine.stop(); engine.inputNode.removeTap(onBus: 0); request?.endAudio()
        DispatchQueue.main.asyncAfter(deadline: .now() + 5) { finish("done", latest) }
    }
}
input.resume()
DispatchQueue.main.asyncAfter(deadline: .now() + 45) { finish("timeout", latest) }
dispatchMain()
